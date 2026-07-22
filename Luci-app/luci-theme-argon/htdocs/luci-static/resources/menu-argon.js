'use strict';
'require baseclass';
'require ui';
'require slide-animations';

// ==========================================================================
// Argon Menu Module
// ==========================================================================
return baseclass.extend({
	// Track registered event listeners for cleanup
	_listeners: [],

	__init__: function () {
		ui.menu.load().then(L.bind(this.render, this));
	},

	/**
	 * Register an event listener with tracking for cleanup
	 */
	_addListener: function (element, event, handler) {
		if (!element) return;
		element.addEventListener(event, handler);
		this._listeners.push({ element: element, event: event, handler: handler });
	},

	/**
	 * Remove all tracked event listeners (memory leak prevention)
	 */
	_removeAllListeners: function () {
		for (var i = 0; i < this._listeners.length; i++) {
			var entry = this._listeners[i];
			entry.element.removeEventListener(entry.event, entry.handler);
		}
		this._listeners = [];
	},

	render: function (tree) {
		var node = tree;
		var url = '';

		// Clean up previous listeners before re-binding (SPA navigation)
		this._removeAllListeners();

		this.renderModeMenu(node);

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}
			if (node) {
				this.renderTabMenu(node, url);
			}
		}

		var sidebarToggle = document.querySelector('a.showSide');
		var darkMask = document.querySelector('.darkMask');

		this._addListener(sidebarToggle, 'click', ui.createHandlerFn(this, 'handleSidebarToggle'));
		this._addListener(darkMask, 'click', ui.createHandlerFn(this, 'handleSidebarToggle'));

		// Apple Design: 恢复侧边栏折叠态偏好
		this.restoreSidebarState();

		// 绑定侧边栏折叠切换按钮
		var collapseToggle = document.querySelector('.sidebar-toggle');
		this._addListener(collapseToggle, 'click', ui.createHandlerFn(this, 'handleSidebarCollapse'));
	},

	handleMenuExpand: function (ev) {
		var target = ev.target;
		var slide = target.parentNode;
		var slideMenu = target.nextElementSibling;
		var shouldCollapse = false;

		// Close all active submenus
		var activeMenus = document.querySelectorAll('.main .main-left .nav > li > ul.active');
		activeMenus.forEach(function (ul) {
			SlideAnimations._stop(ul);
			ul.classList.remove('active');
			if (ul.previousElementSibling) {
				ul.previousElementSibling.classList.remove('active');
			}
			SlideAnimations.slideUp(ul, 'fast');

			if (!shouldCollapse && ul === slideMenu) {
				shouldCollapse = true;
			}
		});

		if (!slideMenu) return;

		if (!shouldCollapse) {
			var slideMenuElement = slide.querySelector('.slide-menu');
			if (slideMenuElement) {
				slideMenu.classList.add('active');
				target.classList.add('active');
				SlideAnimations.slideDown(slideMenuElement, 'fast');
			}
			target.blur();
		}

		ev.preventDefault();
		ev.stopPropagation();
	},

	renderMainMenu: function (tree, url, level) {
		var currentLevel = (level || 0) + 1;
		var menuContainer = E('ul', { 'class': level ? 'slide-menu' : 'nav' });
		var children = ui.menu.getChildren(tree);

		if (children.length === 0 || currentLevel > 2) {
			return E([]);
		}

		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var isActive = (
				(L.env.dispatchpath[currentLevel] === child.name) &&
				(L.env.dispatchpath[currentLevel - 1] === tree.name)
			);

			var submenu = this.renderMainMenu(child, url + '/' + child.name, currentLevel);
			var hasChildren = submenu.children.length > 0;

			var slideClass = hasChildren ? 'slide' : null;
			var menuClass = hasChildren ? 'menu' : 'food';

			if (isActive) {
				menuContainer.classList.add('active');
				slideClass += ' active';
				menuClass += ' active';
			}

			var menuItem = E('li', { 'class': slideClass }, [
				E('a', {
					'href': L.url(url, child.name),
					'click': (currentLevel === 1) ? ui.createHandlerFn(this, 'handleMenuExpand') : null,
					'class': menuClass,
					'data-title': (child.title || '').replace(/ /g, '_'),
				}, [_(child.title)]),
				submenu
			]);

			menuContainer.appendChild(menuItem);
		}

		if (currentLevel === 1) {
			var mainMenuElement = document.querySelector('#mainmenu');
			if (mainMenuElement) {
				mainMenuElement.appendChild(menuContainer);
				mainMenuElement.style.display = '';
			}
		}

		return menuContainer;
	},

	renderModeMenu: function (tree) {
		var menu = document.querySelector('#modemenu');
		var children = ui.menu.getChildren(tree);

		for (var i = 0; i < children.length; i++) {
			var isActive = (L.env.requestpath.length ? children[i].name == L.env.requestpath[0] : i == 0);
			if (i > 0)
				menu.appendChild(E([], ['\u00a0|\u00a0']));
			menu.appendChild(E('li', {}, [
				E('a', {
					'href': L.url(children[i].name),
					'class': isActive ? 'active' : null
				}, [_(children[i].title)])
			]));
			if (isActive)
				this.renderMainMenu(children[i], children[i].name);
		}
		if (menu.children.length > 1)
			menu.style.display = '';
	},

	renderTabMenu: function (tree, url, level) {
		var container = document.querySelector('#tabmenu');
		var currentLevel = (level || 0) + 1;
		var tabContainer = E('ul', { 'class': 'tabs' });
		var children = ui.menu.getChildren(tree);
		var activeNode = null;

		if (children.length === 0) {
			return E([]);
		}

		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var isActive = (L.env.dispatchpath[currentLevel + 2] === child.name);
			var activeClass = isActive ? ' active' : '';
			var className = 'tabmenu-item-%s %s'.format(child.name, activeClass);

			var tabItem = E('li', { 'class': className }, [
				E('a', { 'href': L.url(url, child.name) }, [_(child.title)])
			]);

			tabContainer.appendChild(tabItem);

			if (isActive) {
				activeNode = child;
			}
		}

		if (container) {
			container.appendChild(tabContainer);
			container.style.display = '';

			if (activeNode) {
				var nestedTabs = this.renderTabMenu(activeNode, url + '/' + activeNode.name, currentLevel);
				if (nestedTabs.children.length > 0) {
					container.appendChild(nestedTabs);
				}
			}
		}

		return tabContainer;
	},

	handleSidebarToggle: function (ev) {
		var showSideButton = document.querySelector('a.showSide');
		var sidebar = document.querySelector('#mainmenu');
		var darkMask = document.querySelector('.darkMask');
		var scrollbarArea = document.querySelector('.main-right');

		if (!showSideButton || !sidebar || !darkMask || !scrollbarArea) {
			return;
		}

		if (showSideButton.classList.contains('active')) {
			showSideButton.classList.remove('active');
			sidebar.classList.remove('active');
			scrollbarArea.classList.remove('active');
			darkMask.classList.remove('active');
		} else {
			showSideButton.classList.add('active');
			sidebar.classList.add('active');
			scrollbarArea.classList.add('active');
			darkMask.classList.add('active');
		}
	},

	/**
	 * Apple Design: 侧边栏折叠态切换 (icon-only 模式)
	 * 状态持久化到 localStorage, 页面加载时恢复
	 */
	handleSidebarCollapse: function () {
		var sidebar = document.querySelector('.main-left');
		if (!sidebar) return;

		var isCollapsed = sidebar.classList.toggle('collapsed');
		try {
			localStorage.setItem('argon-sidebar-collapsed', isCollapsed ? '1' : '0');
		} catch (e) { /* storage unavailable */ }
	},

	/**
	 * 页面加载时恢复侧边栏折叠态
	 */
	restoreSidebarState: function () {
		var sidebar = document.querySelector('.main-left');
		if (!sidebar) return;

		try {
			if (localStorage.getItem('argon-sidebar-collapsed') === '1') {
				sidebar.classList.add('collapsed');
			}
		} catch (e) { /* storage unavailable */ }
	}
});
