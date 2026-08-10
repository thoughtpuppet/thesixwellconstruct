(function tattooSpecialsMeta(global, document) {
  "use strict";
  if (global.fbq) return;
  var fbq = global.fbq = function () {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  if (!global._fbq) global._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  var script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  var first = document.getElementsByTagName("script")[0];
  first.parentNode.insertBefore(script, first);
  fbq("init", "38032225653089853");
  fbq("track", "PageView");
})(window, document);
