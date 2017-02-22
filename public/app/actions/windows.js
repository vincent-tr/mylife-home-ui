'use strict';

import async from 'async';
import { createAction } from 'redux-actions';
import { push as routerPush } from 'react-router-redux';
import { actionTypes } from '../constants';

import browser from '../utils/detect-browser.js';

import { resourceQuery } from './resources';
import { getWindows } from '../selectors/windows';

const internalWindowsPopup  = createAction(actionTypes.WINDOWS_POPUP);
const internalWindowsClose  = createAction(actionTypes.WINDOWS_CLOSE);
const internalWindowsChange = createAction(actionTypes.WINDOWS_CHANGE);

function getPathWindow(state) {
  const routingState = state.routing.locationBeforeTransitions;
  if(!routingState) { return null; }
  let { pathname } = routingState;
  pathname = pathname.substr(1);
  return pathname;
}

function getDefaultWindow(dispatch, done) {
  return dispatch(resourceQuery({ resource: 'default_window', done: (err, data) => {
    if(err) { return done(err); } // eslint-disable-line no-console
    const windows = JSON.parse(data);
    return done(null, browser.isMobile ? windows.mobile : windows.desktop);
  }}));
}

export const windowsInit = () => (dispatch, getState) => {
  const state = getState();
  if(getPathWindow(state)) {
    console.log('window already opened, not using default window'); // eslint-disable-line no-console
    return;
  }

  return getDefaultWindow(dispatch, (err, defaultWindow) => {
    if(err) { return console.error(err); } // eslint-disable-line no-console

    console.log(`using default window: ${defaultWindow}`); // eslint-disable-line no-console
    dispatch(windowChange(defaultWindow));
  });
};

export const windowChange = (id) => (dispatch, getState) => {
  const pathname = `/${id}`;
  const state = getState();
  const routingState = state.routing.locationBeforeTransitions;
  if(routingState && routingState.pathname === pathname) {
    return dispatch(windowNavigationChange(id)); // cannot change to same path
  }
  dispatch(routerPush(pathname));
};

function addImage(resources, id) {
  if(!id) { return; }
  resources.add(`image.${id}`);
}

function loadWindowAndDispatch(dispatch, id, action) {
  return dispatch(resourceQuery({ resource: `window.${id}`, done: (err, data) => {
    if(err) { return console.error(err); } // eslint-disable-line no-console
    const window = JSON.parse(data).window;

    // load all associated resources
    const resources = new Set();
    addImage(window.background_resource_id);
    for(const control of window.controls) {
      const display = control.display;
      if(!display) { continue; }
      addImage(resources, display.default_resource_id);

      const map = display.map;
      if(!map) { continue; }
      for(const item of map) {
        addImage(resources, item.resource_id);
      }
    }

    async.parallel(Array.from(resources).map(resource => done => dispatch(resourceQuery({ resource, done }))), (err) => {
      if(err) { return console.error(err); } // eslint-disable-line no-console
      return dispatch(action(window));
    });
  }}));
}

export const windowNavigationChange = (id) => (dispatch) => {
  return loadWindowAndDispatch(dispatch, id, internalWindowsChange);
};

export const windowPopup = (id) => (dispatch) => {
  return loadWindowAndDispatch(dispatch, id, internalWindowsPopup);
};

export const windowClose = () => (dispatch, getState) => {
  const state = getState();
  const windows = getWindows(state);
  if(windows.size <= 1) {
    console.error('Cannot close root window!'); // eslint-disable-line no-console
    return;
  }
  return dispatch(internalWindowsClose());
};
