"use strict";

const CACHE_NAME = "dnsc-clearance-shell-v2";
const BASE_URL = new URL("./", self.registration.scope);
const APP_SHELL = [
  "index.html",
  "manifest.webmanifest",
  "assets/css/base.css",
  "assets/css/layout.css",
  "assets/css/components.css",
  "assets/js/api.js",
  "assets/js/common.js",
  "assets/icons/clearance.svg",
  "modules/auth/login.html",
  "modules/auth/login.js",
  "modules/staff/registrar/registrar.html",
  "modules/staff/library/library.html",
  "modules/staff/accounting/accounting.html",
  "modules/staff/student-affairs/student-affairs.html"
].map(function (path) {
  return new URL(path, BASE_URL).href;
});

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf("dnsc-clearance-shell-") === 0 && key !== CACHE_NAME;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || (request.mode === "navigate" ? caches.match(new URL("index.html", BASE_URL)) : undefined);
      });
    })
  );
});
