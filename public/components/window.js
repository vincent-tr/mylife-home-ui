'use strict';

/*

Format données fenêtre
{
  "id" : "w1",
  "height" : "0.5", //en fraction de la taille de l'écran, uniquement utilisé si popup (sinon fullscreen)
  "width" : "0.25", //en fraction de la taille de l'écran, uniquement utilisé si popup (sinon fullscreen)
  "background_resource_id" : "bg_res",
  "style": "données css", // facultatif
  "controls" : [
    {
      "id": "c1",
      "x" : "0.23", // x du milieu du control, en fraction de la taille de la fenêtre
      "y" : "0.27", // y du milieu du control, en fraction de la taille de la fenêtre
      "height" : "12", // px, facultatif
      "width" : "12", // px, facultatif
      "style": "données css", // facultatif

      "display": { // mutuellement exclusif avec text
        "default_resource_id": "res_id", // image par défaut
        "component_id": "obj_id", // si non défini, pas de modif de l'image
        "component_attribute": "attr",
        "map": [
          {
            "value": "enum_value", // pour les attributs enum
            "min": "range_min", // pour les attributs range
            "max": "range_max", // pour les attributs range
            "resource_id": "res_id"
          },
          ...
        ]
      }

      "text": { // mutuellement exclusif avec display
        "format": "toto, avec des #data_id#", // toto en javascript, avec des valeur_de_data_id
        "context": [
          {
                    "component_id": "cid",
                    "component_attribute": "attr",
                    "id": "data_id"
          }
        ]
      },

      "primary_action": {
        "window": { // soit ca soit component
          "id": "wid",
          "popup": "true|false",
        }
        "component": { // soit ca soit window
          "component_id": "obj_id",
          "component_action": "obj_action"
        }
      }

      "secondary_action": {} // pareil que primary
    },
    ...
  ]
}

*/

import async from 'async';

angular.module('mylife-home-ui.components.window', ['mylife-home-ui.components.data', 'mylife-home-ui.components.repository'])

.factory('windowManager', function(resources, socket, repository, $location) {

  // ------------- Window management part ---------------------

  const cachedWindows = { };

  const manager = {
    defaultWindowId : null,
    windows         : [],
    loading         : false
  };

  function load(windowId, done) {
    const cw = cachedWindows[windowId];
    if(cw) { return done(cw); }
    manager.loading = true;
    return windowFactory(windowId, function(w) {
      manager.loading = false;
      return done(w);
    });
  }

  manager.init = function(done) {
    resources.load('default_window', function(data) {
      manager.defaultWindowId = data;
      done();
    });
  };

  manager.popup = function(windowId, done) {
    return load(windowId, function(w) {
      manager.windows.push(w);
      done(w);
    });
  };

  manager.change = function(windowId, done) {
    return load(windowId, function(w) {
      manager.windows.length = 0;
      manager.windows.push(w);
      done(w);
    });
  };

  manager.close = function() {
    if(manager.windows.length <= 1) { return; } // popup only
    manager.windows.pop();
  };

  // ------------- Window factory part ---------------------

  function windowFactory(windowId, done) {

    resources.load('window.' + windowId, function(data) {

      const loaders = [];
      const imageLoaders = {};

      function loadImage(imageId, setter) {
        let setters = imageLoaders[imageId];
        if(!setters) {
          setters = imageLoaders[imageId] = [];
          loaders.push((done) => {
            resources.load('image.' + imageId, function(data) {
              data = 'data:image/png;base64,' + data;
              for(let setter of setters) {
                setter(data);
              }
              done();
            });
          });
        }
        setters.push(setter);
      }

      function loadAction(spec) {
        if(!spec) { spec = null; }

        const a = {
          spec : spec
        };

        if(spec) {
          const cspec = spec.component;
          if(cspec) {
            a.execute = () => {
              socket.emit('action', {
                id   : cspec.component_id,
                name : cspec.component_action
                //args :[]
              });
            };
          }

          const wspec = spec.window;
          if(wspec) {
            a.execute = function() {
              if(wspec.popup) {
                manager.popup(wspec.id, () => { });
              } else {
                //manager.change(wspec.id, () => { });
                $location.url('/' + wspec.id);
              }
            };
          }
        }

        if(!a.execute) {
          a.execute = () => { };
        }

        return a;
      }

      function loadDisplay(spec) {
        if(!spec) { return () => null; }

        const images = {};

        function loadImageLocal(key) {
          if(images.hasOwnProperty(key)) { return; } // already loading
          images[key] = null;
          loadImage(key, (img) => images[key] = img);
        }

        if(spec.default_resource_id) {
          loadImageLocal(spec.default_resource_id);
        }

        for(let item of spec.map) {
          loadImageLocal(item.resource_id);
        }

        let itemFinder;
        if(!spec.map.length) {
          itemFinder = () => null;
        }
        else if(spec.map[0].hasOwnProperty('value')) {
          itemFinder = (value) => {
            for(let item of spec.map) {
              if(item.value === value) {
                return item;
              }
            }
            return null;
          };
        }
        else {
          itemFinder = (value) => {
            value = parseInt(value);
            for(let item of spec.map) {
              if(item.min <= value && value <= item.max) {
                return item;
              }
            }
            return null;
          };
        }

        return () => {
          let value;
          const obj = repository.get(spec.component_id);
          if(obj) { value = obj[spec.component_attribute]; }
          const item = value === undefined ? null : itemFinder(value);
          if(item) {
            return images[item.resource_id];
          }
          return images[spec.default_resource_id];
        };
      }

      function loadText(spec) {
        if(!spec) { return () => null; }

        function valueGetter(item) {
          return () => {
            let value;
            const obj = repository.get(item.component_id);
            if(obj) { value = obj[item.component_attribute]; }
            return value || '';
          };
        }

        const context = [];

        for(let item of spec.context) {
          context.push({ id : '#' + item.id + '#', getter : valueGetter(item) });
        }

        return () => {
          let text = spec.format;
          for(let item of context) {
            text = text.replace(new RegExp(item.id, 'g'), item.getter());
          }
          return text;
        };
      }

      function loadControl(spec) {
        const c = {
          spec : spec,
          id   : spec.id,

          height          : spec.height,
          width           : spec.width,
          x               : 0, // TODO: ratio
          y               : 0, // TODO: ratio
          primaryAction   : loadAction(spec.primary_action),
          secondaryAction : loadAction(spec.secondary_action),
          display         : null,
          text            : null
        };

        Object.defineProperty(c, 'display', { get : loadDisplay(spec.display) });
        Object.defineProperty(c, 'text', { get : loadText(spec.text) });

        return c;
      }

      const spec = JSON.parse(data).window;

      const w = {
        spec       : spec,
        id         : spec.id,

        height          : spec.height, // TODO: handle undefined
        width           : spec.width, // TODO: handle undefined
        background : null,
        controls   : []
      };

      if(w.spec.background_resource_id) {
        loadImage(w.spec.background_resource_id, (img) => w.background = img);
      }

      for(let ctrlSpec of spec.controls) {
        const c = loadControl(ctrlSpec);
        w.controls.push(c);
      }

      async.parallel(loaders, () => done(w));
    });
  }

  return manager;
});
