'use strict';

// ==========================================================================
// SlideAnimations — 纯 CSS transition + transitionend 事件驱动
// 可被任意 LuCI 页面复用, 替代 setTimeout 方案
// ==========================================================================
var SlideAnimations = {
	durations: {
		fast: 180,
		normal: 280,
		slow: 400
	},

	slideDown: function (element, duration, callback) {
		if (!element) return;
		this._stop(element);

		var ms = this._resolveDuration(duration);
		var targetHeight = element.scrollHeight;

		element.style.display = 'block';
		element.style.overflow = 'hidden';
		element.style.height = '0px';
		element.style.transition = 'height ' + ms + 'ms cubic-bezier(0.23, 1, 0.32, 1)';

		element.offsetHeight; // force reflow
		element.style.height = targetHeight + 'px';

		var cleanup = this._makeCleanup(element, true, callback);
		element._slideCleanup = cleanup;
		element.addEventListener('transitionend', cleanup, { once: true });
		element._slideFallback = setTimeout(cleanup, ms + 80);
	},

	slideUp: function (element, duration, callback) {
		if (!element) return;
		this._stop(element);

		var ms = this._resolveDuration(duration);
		var currentHeight = element.scrollHeight;

		element.style.overflow = 'hidden';
		element.style.height = currentHeight + 'px';
		element.style.transition = 'height ' + ms + 'ms cubic-bezier(0.55, 0, 0.55, 0.2)';

		element.offsetHeight; // force reflow
		element.style.height = '0px';

		var cleanup = this._makeCleanup(element, false, callback);
		element._slideCleanup = cleanup;
		element.addEventListener('transitionend', cleanup, { once: true });
		element._slideFallback = setTimeout(cleanup, ms + 80);
	},

	_stop: function (element) {
		if (element._slideCleanup) {
			element.removeEventListener('transitionend', element._slideCleanup);
			element._slideCleanup = null;
		}
		if (element._slideFallback) {
			clearTimeout(element._slideFallback);
			element._slideFallback = null;
		}
		element.style.transition = '';
		element.offsetHeight;
	},

	_makeCleanup: function (element, isOpen, callback) {
		return function cleanup() {
			if (!element || !element.parentNode) return;

			clearTimeout(element._slideFallback);
			element._slideFallback = null;
			element._slideCleanup = null;

			if (isOpen) {
				element.style.height = '';
			} else {
				element.style.display = 'none';
				element.style.height = '';
			}
			element.style.overflow = '';
			element.style.transition = '';

			if (typeof callback === 'function') {
				try { callback.call(element); }
				catch (e) { /* ignore */ }
			}
		};
	},

	_resolveDuration: function (d) {
		return typeof d === 'string' ? (this.durations[d] || this.durations.normal) : (d || this.durations.normal);
	}
};
