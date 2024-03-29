import React from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";

import getStore from "./store";
import App from "./components/App";
import Hotkeys from "./hotkeys";
import Media from "./media";
import * as Selectors from "./selectors";
import {
  setSkinFromUrl,
  loadMediaFiles,
  setWindowSize,
  play,
  pause,
  seekBackward,
  seekForward,
  next,
  previous
} from "./actionCreators";
import { LOAD_STYLE } from "./constants";
import { uniqueId, objectMap, objectForEach } from "./utils";

import {
  SET_AVAILABLE_SKINS,
  NETWORK_CONNECTED,
  NETWORK_DISCONNECTED,
  CLOSE_WINAMP,
  MINIMIZE_WINAMP,
  ADD_GEN_WINDOW,
  UPDATE_WINDOW_POSITIONS,
  LOADED,
  REGISTER_VISUALIZER,
  SET_Z_INDEX,
  CLOSE_REQUESTED
} from "./actionTypes";
import Emitter from "./emitter";

import "../css/base-skin.min.css";

// Return a promise that resolves when the store matches a predicate.
const storeHas = (store, predicate) =>
  new Promise(resolve => {
    if (predicate(store.getState())) {
      resolve();
      return;
    }
    const unsubscribe = store.subscribe(() => {
      if (predicate(store.getState())) {
        resolve();
        unsubscribe();
      }
    });
  });

class Winamp {
  static browserIsSupported() {
    const supportsAudioApi = !!(
      window.AudioContext || window.webkitAudioContext
    );
    const supportsCanvas = !!window.document.createElement("canvas").getContext;
    const supportsPromises = typeof Promise !== "undefined";
    return supportsAudioApi && supportsCanvas && supportsPromises;
  }

  constructor(options) {
    this._actionEmitter = new Emitter();
    this.options = options;
    const {
      initialTracks,
      initialSkin,
      avaliableSkins, // Old misspelled name
      availableSkins,
      enableHotkeys = false,
      zIndex,
      requireJSZip,
      requireJSMediaTags,
      __extraWindows
    } = this.options;

    // TODO: Validate required options

    this.media = new Media();
    this.store = getStore(
      this.media,
      this._actionEmitter,
      this.options.__customMiddlewares,
      this.options.__initialState,
      { requireJSZip, requireJSMediaTags }
    );
    this.store.dispatch({
      type: navigator.onLine ? NETWORK_CONNECTED : NETWORK_DISCONNECTED
    });

    if (zIndex != null) {
      this.store.dispatch({ type: SET_Z_INDEX, zIndex });
    }

    this.genWindows = [];
    if (__extraWindows) {
      this.genWindows = __extraWindows.map(genWindow => ({
        id: genWindow.id || `${genWindow.title}-${uniqueId()}`,
        ...genWindow
      }));

      __extraWindows.forEach(genWindow => {
        if (genWindow.isVisualizer) {
          this.store.dispatch({ type: REGISTER_VISUALIZER, id: genWindow.id });
        }
      });
    }

    this.genWindows.forEach(genWindow => {
      this.store.dispatch({
        type: ADD_GEN_WINDOW,
        windowId: genWindow.id,
        title: genWindow.title,
        open: genWindow.open
      });
    });

    window.addEventListener("online", () =>
      this.store.dispatch({ type: NETWORK_CONNECTED })
    );
    window.addEventListener("offline", () =>
      this.store.dispatch({ type: NETWORK_DISCONNECTED })
    );

    if (initialSkin) {
      this.store.dispatch(setSkinFromUrl(initialSkin.url));
    } else {
      // We are using the default skin.
      this.store.dispatch({ type: LOADED });
    }

    if (initialTracks) {
      this.appendTracks(initialTracks);
    }

    if (avaliableSkins != null) {
      console.warn(
        "The misspelled option `avaliableSkins` is deprecated. Please use `availableSkins` instead."
      );
      this.store.dispatch({ type: SET_AVAILABLE_SKINS, skins: avaliableSkins });
    } else if (availableSkins != null) {
      this.store.dispatch({ type: SET_AVAILABLE_SKINS, skins: availableSkins });
    }

    const layout = options.__initialWindowLayout;
    if (layout != null) {
      objectForEach(layout, (w, windowId) => {
        if (w.size != null) {
          this.store.dispatch(setWindowSize(windowId, w.size));
        }
      });
      this.store.dispatch({
        type: UPDATE_WINDOW_POSITIONS,
        positions: objectMap(layout, w => w.position)
      });
    }

    if (enableHotkeys) {
      new Hotkeys(this.store.dispatch);
    }
  }

  play() {
    this.store.dispatch(play());
  }

  pause() {
    this.store.dispatch(pause());
  }

  seekBackward(seconds) {
    this.store.dispatch(seekBackward(seconds));
  }

  seekForward(seconds) {
    this.store.dispatch(seekForward(seconds));
  }

  nextTrack() {
    this.store.dispatch(next());
  }

  previousTrack() {
    this.store.dispatch(previous());
  }

  // Append this array of tracks to the end of the current playlist.
  appendTracks(tracks) {
    const nextIndex = Selectors.getTrackCount(this.store.getState());
    this.store.dispatch(loadMediaFiles(tracks, LOAD_STYLE.BUFFER, nextIndex));
  }

  // Replace any existing tracks with this array of tracks, and begin playing.
  setTracksToPlay(tracks) {
    this.store.dispatch(loadMediaFiles(tracks, LOAD_STYLE.PLAY));
  }

  onWillClose(cb) {
    return this._actionEmitter.on(CLOSE_REQUESTED, action => {
      cb(action.cancel);
    });
  }

  onClose(cb) {
    return this._actionEmitter.on(CLOSE_WINAMP, cb);
  }

  onTrackDidChange(cb) {
    let previousTrackId = null;
    this.store.subscribe(() => {
      const state = this.store.getState();
      const trackId = Selectors.getCurrentlyPlayingTrackIdIfLoaded(state);
      if (trackId === previousTrackId) {
        return;
      }
      previousTrackId = trackId;
      cb(trackId == null ? null : Selectors.getCurrentTrackInfo(state));
    });
  }

  onMinimize(cb) {
    return this._actionEmitter.on(MINIMIZE_WINAMP, cb);
  }

  async skinIsLoaded() {
    // Wait for the skin to load.
    return storeHas(this.store, state => !state.display.loading);
  }

  async renderWhenReady(node) {
    await this.skinIsLoaded();
    const genWindowComponents = {};
    this.genWindows.forEach(w => {
      genWindowComponents[w.id] = w.Component;
    });

    render(
      <Provider store={this.store}>
        <App
          media={this.media}
          container={node}
          filePickers={this.options.filePickers}
          genWindowComponents={genWindowComponents}
        />
      </Provider>,
      node
    );
  }

  destroy() {
    // TODO: Clean up event emitter subscriptions
    // TODO: Clean up hotkey bindings, if needed
    // TODO: Clean up the Media instance
    // TODO: Clean up online/offline subscriptions on window
    // TODO: Clean up store subscription in onTrackDidChange
    // TODO: Every storeHas call represents a potential race condition
    throw new Error("Not implemented");
  }
}

export default Winamp;
