'use strict';
'require view';
'require adguardhome.ui as aghui';
'require form';
'require rpc';
'require uci';

var callGetStatus = rpc.declare({ object: 'luci.adguardhome', method: 'getStatus', expect: { '': {} } });
var callGetMeta = rpc.declare({ object: 'luci.adguardhome', method: 'getMeta', expect: { '': {} } });
var callSetLinks = rpc.declare({ object: 'luci.adguardhome', method: 'setLinks', params: [ 'content', 'channel', 'download_arch' ], expect: { '': {} } });
var callStartUpdate = rpc.declare({ object: 'luci.adguardhome', method: 'startUpdate', params: [ 'force' ], expect: { '': {} } });
var callGfwAction = rpc.declare({ object: 'luci.adguardhome', method: 'gfwAction', params: [ 'action' ], expect: { '': {} } });

var ACTION_MUTATES_GFW_YAML = {
	ipset_add: true,
	ipset_del: true
};

function hasChineseLocale() {
	var htmlLang = document.documentElement ? (document.documentElement.lang || '') : '';
	var bodyClass = document.body ? (document.body.className || '') : '';
	return /^zh(?:-|_|$)/i.test(htmlLang) || /\blang_zh(?:[-_][^\s]+)?\b/i.test(bodyClass);
}

function t(message, fallback) {
	var translated = _(message);
	return translated !== message || !fallback || !hasChineseLocale() ? translated : fallback;
}

function normalizeChannel(value) {
	return [ 'release', 'beta', 'github', 'custom' ].indexOf(value) >= 0 ? value : 'release';
}

function yes(value) {
	return value === true || value === 1 || value === '1';
}

function text(value, fallback) {
	value = value == null ? '' : String(value);
	return value || fallback || '-';
}

function isDarkTheme() {
	if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body)
		return false;

	var html = document.documentElement;
	var htmlClass = html ? (html.className || '') : '';
	var bodyClass = document.body.className || '';
	var htmlTheme = html ? (html.getAttribute('data-theme') || '') : '';
	var bodyTheme = document.body.getAttribute('data-theme') || '';
	var background = window.getComputedStyle(document.body).backgroundColor || '';
	var channels = background.match(/\d+(?:\.\d+)?/g);
	var luminance;

	if (/\b(?:dark|mode-dark|argon-dark)\b/i.test(htmlClass) || /\b(?:dark|mode-dark|argon-dark)\b/i.test(bodyClass))
		return true;

	if (/dark/i.test(htmlTheme) || /dark/i.test(bodyTheme))
		return true;

	if (/light/i.test(htmlTheme) || /light/i.test(bodyTheme))
		return false;

	if (!channels || channels.length < 3)
		return false;

	luminance = (Number(channels[0]) * 299 + Number(channels[1]) * 587 + Number(channels[2]) * 114) / 1000;
	return luminance < 140;
}

function applyThemeClass(node, darkClass) {
	function syncThemeClass() {
		node.classList.toggle(darkClass, isDarkTheme());
	}
	var retries = [ 0, 80, 220, 480, 900 ];
	var index;
	var mediaQuery;

	syncThemeClass();

	if (typeof window !== 'undefined') {
		for (index = 0; index < retries.length; index++)
			window.setTimeout(syncThemeClass, retries[index]);

		if (window.requestAnimationFrame)
			window.requestAnimationFrame(syncThemeClass);

		/* Singleton MutationObserver — avoid observer accumulation on re-render */
		if (typeof MutationObserver !== 'undefined' && document.documentElement) {
			if (!applyThemeClass._themeObserver) {
				applyThemeClass._themeObserver = new MutationObserver(function() {
					var nodes = applyThemeClass._themeQueue;
					var i;
					if (!nodes) return;
					for (i = 0; i < nodes.length; i++) {
						if (nodes[i] && nodes[i].classList)
							nodes[i].classList.toggle(darkClass, isDarkTheme());
					}
				});
				applyThemeClass._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
				if (document.body && document.body !== document.documentElement)
					applyThemeClass._themeObserver.observe(document.body, { attributes: true, attributeFilter: [ 'class', 'style', 'data-theme' ] });
			}
			if (!applyThemeClass._themeQueue)
				applyThemeClass._themeQueue = [];
			/* Prune detached nodes to prevent unbounded growth on re-render */
			applyThemeClass._themeQueue = applyThemeClass._themeQueue.filter(function(n) { return n && document.body && document.body.contains(n); });
			if (applyThemeClass._themeQueue.indexOf(node) === -1)
				applyThemeClass._themeQueue.push(node);
		}

		/* Singleton mediaQuery — register once, traverse queue on change */
		applyThemeClass._darkClass = darkClass;
		if (!applyThemeClass._mediaQueryRegistered && window.matchMedia) {
			applyThemeClass._mediaQueryRegistered = true;
			var mq = window.matchMedia('(prefers-color-scheme: dark)');
			if (mq) {
				var onColorSchemeChange = function() {
					var nodes = applyThemeClass._themeQueue;
					var i;
					if (!nodes) return;
					for (i = 0; i < nodes.length; i++) {
						if (nodes[i] && nodes[i].classList)
							nodes[i].classList.toggle(applyThemeClass._darkClass || darkClass, isDarkTheme());
					}
				};
				if (mq.addEventListener)
					mq.addEventListener('change', onColorSchemeChange);
				else if (mq.addListener)
					mq.addListener(onColorSchemeChange);
			}
		}

		/* Singleton window listeners — register once, not per applyThemeClass call */
		if (!applyThemeClass._windowListenersAttached) {
			applyThemeClass._windowListenersAttached = true;
			window.addEventListener('pageshow', syncThemeClass);
			window.addEventListener('focus', syncThemeClass);
		}
	}

	return node;
}

function buildLinks(channel) {
	switch (normalizeChannel(channel)) {
	case 'beta':
		return '# Beta channel\nhttps://static.adguard.com/adguardhome/beta/AdGuardHome_linux_${Arch}.tar.gz\n# Stable fallback\nhttps://static.adguard.com/adguardhome/release/AdGuardHome_linux_${Arch}.tar.gz\n# GitHub fallback\nhttps://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}/AdGuardHome_linux_${Arch}.tar.gz';
	case 'github':
		return '# GitHub release channel\nhttps://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}/AdGuardHome_linux_${Arch}.tar.gz\n# Stable fallback\nhttps://static.adguard.com/adguardhome/release/AdGuardHome_linux_${Arch}.tar.gz';
	default:
		return '# Stable channel\nhttps://static.adguard.com/adguardhome/release/AdGuardHome_linux_${Arch}.tar.gz\n# GitHub fallback\nhttps://github.com/AdguardTeam/AdGuardHome/releases/download/${latest_ver}/AdGuardHome_linux_${Arch}.tar.gz\n# Beta channel\n#https://static.adguard.com/adguardhome/beta/AdGuardHome_linux_${Arch}.tar.gz';
	}
}

function actionError(err, fallback) {
	var message = err && (err.message || err.toString && err.toString()) || '';
	var knownErrors = [
		[/Failed to download a non-empty GFW list from all known mirrors\./i, t('Could not download a usable GFW list from any known mirror. Check network/DNS access to jsDelivr and GitHub Raw, then retry.', '无法从任何已知镜像下载 GFW 列表，请检查到 jsDelivr / GitHub Raw 的联网或 DNS 后重试。')],
		[/Failed to generate a non-empty GFW rule file\./i, t('The downloaded GFW list produced no usable upstream DNS rules. Retry later or check the source list.', 'GFW 列表未生成可用的上游 DNS 规则，请稍后重试或检查列表内容。')],
		[/Please generate the GFW rule file first\./i, t('Generate the GFW rule file first, then copy entries in the AdGuard Home console.', '请先生成 GFW 规则文件，再到 AdGuard Home 控制台复制条目。')],
		[/The GFW rule file is empty\./i, t('The GFW rule file has only headers and no usable rules. Regenerate it before copying entries.', 'GFW 规则文件只有表头、无可用规则，请重新生成后再复制条目。')]
	];
	var i;
	if (/Object not found/i.test(message))
		return t('The luci.adguardhome rpcd object is missing. Reinstall this package or restart rpcd, then refresh LuCI.', '缺少 luci.adguardhome rpcd 后端对象，请重装本包或重启 rpcd 后刷新 LuCI。');
	if (/Method not found/i.test(message))
		return t('The rpcd backend is outdated and lacks this action. Reinstall this package or restart rpcd, then refresh LuCI.', 'rpcd 后端过旧、不支持此操作，请重装本包或重启 rpcd 后刷新 LuCI。');
	for (i = 0; i < knownErrors.length; i++)
		if (knownErrors[i][0].test(message))
			return knownErrors[i][1];
	return fallback + (message ? ': ' + message : '');
}

function safeCall(promise, fallback) {
	return promise.catch(function(err) {
		return Object.assign({ _rpc_error: err }, fallback || {});
	});
}

function setBusy(button, busy) {
	button.disabled = !!busy;
	button.classList.toggle('spinning', !!busy);
}

function createStatusBox(message) {
	return E('div', { 'class': 'agh-status' }, message || t('Ready.', '就绪。'));
}

function actionHeader(label, title) {
	return E('div', { 'class': 'agh-action-head' }, [
		E('span', { 'class': 'agh-action-badge' }, label),
		E('h3', {}, title)
	]);
}

function runRpcAction(button, statusBox, call, success, fallback) {
	setBusy(button, true);
	statusBox.className = 'agh-status agh-warn';
	return call().then(function(res) {
		if (res && res.ok === false)
			throw new Error(res.error || fallback);
		statusBox.textContent = success;
		statusBox.className = 'agh-status agh-ok';
	}).catch(function(err) {
		statusBox.textContent = actionError(err, fallback);
		statusBox.className = 'agh-status agh-bad';
	}).finally(function() {
		setBusy(button, false);
	});
}

function ensureScript(src, id) {
	if (document.getElementById(id))
		return Promise.resolve();
	return new Promise(function(resolve, reject) {
		var script = document.createElement('script');
		script.id = id;
		script.src = src;
		script.onload = resolve;
		script.onerror = reject;
		document.head.appendChild(script);
	});
}

function ensureBcrypt() {
	return ensureScript(L.resource('twin-bcrypt.min.js'), 'agh-bcrypt-script');
}

function softButtonClass(extraClass) {
	return 'btn cbi-button agh-soft-btn' + (extraClass ? ' ' + extraClass : '');
}


var style = aghui.style;

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('AdGuardHome'),
			safeCall(callGetStatus(), {}),
			safeCall(callGetMeta(), { backup_choices: [ 'filters', 'stats.db', 'querylog.json', 'sessions.db' ] })
		]);
	},
	render: function(data) {
		var status = data[1] || {};
		var meta = data[2] || {};
		var linksText = meta.links || buildLinks(status.release_channel);
		var rpcError = status._rpc_error || meta._rpc_error;
		var passwallUpstreamPort = text(status.redirect_compat_upstream, '');
		var passwallUpstreamDetected = /^[0-9]+$/.test(passwallUpstreamPort);
		var passwallUpstreamAutoEnabled = yes(status.passwall_upstream_auto);
		var passwallUpstreamHelp = passwallUpstreamDetected
			? t('Detected PassWall DNS frontend: ', '检测到 PassWall DNS 前端：') + '127.0.0.1:' + passwallUpstreamPort + '. ' +
				t('Only this managed upstream is maintained; other upstreams stay untouched.', '只维护这一条托管上游，其它上游不受影响。')
			: (passwallUpstreamAutoEnabled
				? t('Enabled, but no PassWall DNS resolver detected yet, so no managed entry is kept.', '已启用，但暂未检测到 PassWall 的 DNS 解析器，暂不写入托管上游。')
				: t('Maintain one managed PassWall upstream whenever PassWall serves DNS: its own DNS frontend, or the system dnsmasq carrying its split-domain rules when its redirect is off.', '启用后，只要 PassWall 提供 DNS 服务就维护一条托管上游：优先用它的 DNS 前端，其重定向关闭时改用承载分流规则的系统 dnsmasq。'));
		var linksBox = E('textarea', {}, linksText);
		var channelSelect = E('select', {}, [
			E('option', { value: 'release' }, t('Stable', '稳定版')),
			E('option', { value: 'beta' }, t('Beta', '测试版')),
			E('option', { value: 'github' }, 'GitHub'),
			E('option', { value: 'custom' }, t('Custom', '自定义'))
		]);
		var archSelect = E('select', {}, [
			E('option', { value: 'auto' }, t('Auto', '自动')),
			E('option', { value: '386' }, 'i386'), E('option', { value: 'amd64' }, 'x86_64'), E('option', { value: 'armv5' }, 'armv5'), E('option', { value: 'armv6' }, 'armv6'), E('option', { value: 'armv7' }, 'armv7'), E('option', { value: 'arm64' }, 'aarch64'), E('option', { value: 'mips_softfloat' }, 'mips'), E('option', { value: 'mips64_softfloat' }, 'mips64'), E('option', { value: 'mipsle_softfloat' }, 'mipsel'), E('option', { value: 'mips64le_softfloat' }, 'mips64el'), E('option', { value: 'ppc64le' }, 'powerpc64')
		]);

		channelSelect.value = normalizeChannel(status.release_channel);
		archSelect.value = status.downloadarch || 'auto';
		channelSelect.addEventListener('change', function() {
			if (channelSelect.value !== 'custom')
				linksBox.value = buildLinks(channelSelect.value);
		});
		linksBox.addEventListener('input', function() { channelSelect.value = 'custom'; });

		var m = new form.Map('AdGuardHome', null, t('Grouped service, network, update and maintenance options. Use Save & Apply after changing UCI settings.', '设置项已按服务、网络、更新和维护分组。修改 UCI 配置后请点击保存并应用。'));
		var s = m.section(form.NamedSection, 'AdGuardHome', 'AdGuardHome', t('Configuration', '配置'));
		s.addremove = false;
		s.anonymous = true;
		s.tab('service', t('Basic settings', '基础设置'), t('Enable the daemon and define how it starts.', '启用守护进程并设置启动方式。'));
		s.tab('network', t('DNS Access', 'DNS 接入'), t('Management port and DNS redirect behaviour.', '网页管理端口与 DNS 重定向行为。'));
		s.tab('files', t('File paths', '文件路径'), t('Binary, YAML, workspace and log paths.', '核心文件、YAML、工作目录和日志路径。'));
		s.tab('update', t('Core update', '核心更新'), t('Core update source and startup update behaviour.', '核心更新源和启动更新行为。'));
		s.tab('rules', t('GFW rules', 'GFW 规则'), t('GFW rule export and upstream options.', 'GFW 规则导出与上游 DNS 选项。'));
		s.tab('maintenance', t('Backup and tasks', '备份与任务'), t('Backup, upgrade retention and scheduled tasks.', '备份、升级保留和计划任务。'));
		var o;
		o = s.taboption('service', form.Flag, 'enabled', t('Enable service', '启用服务'), t('Start AdGuard Home through procd when this option is enabled.', '启用后通过 procd 启动 AdGuard Home。'));
		o = s.taboption('service', form.Flag, 'waitonboot', t('Wait for network on boot', '开机等待网络'), t('Delay service startup until the network is ready.', '开机时等待网络就绪后再启动服务。'));
		o = s.taboption('service', form.Value, 'username', t('API login username', 'API 登录用户名'), t('Username LuCI uses for the local AdGuard Home API; keep it in sync with the AdGuard Home admin account.', 'LuCI 访问本地 AdGuard Home API 的用户名，需与管理员账号一致。')); o.placeholder = 'root'; o.rmempty = false;
		o = s.taboption('service', form.Value, 'password', t('API login password', 'API 登录密码'), t('Password LuCI uses for the local AdGuard Home API; update it after changing the AdGuard Home web password.', 'LuCI 访问本地 AdGuard Home API 的密码，改后台密码后需同步更新。')); o.password = true; o.rmempty = true;
		o = s.taboption('service', form.Value, 'hashpass', t('Web password bcrypt hash', 'Web 密码 bcrypt 哈希'), t('Use the password helper to generate a hash, then save and apply.', '可使用密码助手生成哈希，然后保存并应用。')); o.password = true; o.rmempty = true;

		o = s.taboption('network', form.Value, 'httpport', t('Web console port', 'Web 控制台端口'), t('Port used by the AdGuard Home management UI.', 'AdGuard Home 管理界面使用的端口。')); o.datatype = 'port'; o.placeholder = '3000';
		o = s.taboption('network', form.ListValue, 'redirect', t('DNS redirect mode', 'DNS 重定向模式'), t('Choose how LAN DNS traffic is handed to AdGuard Home.', '选择局域网 DNS 流量交给 AdGuard Home 的方式。')); o.default = 'dnsmasq-upstream'; o.value('none', t('None', '无')); o.value('dnsmasq-upstream', t('Use as dnsmasq upstream', '作为 dnsmasq 上游')); o.value('redirect', t('Redirect port 53', '重定向 53 端口')); o.value('exchange', t('Swap with dnsmasq port', '与 dnsmasq 交换端口'));
		o = s.taboption('network', form.Flag, 'passwall_upstream_auto', t('Managed PassWall upstream', '托管 PassWall 上游'), passwallUpstreamHelp);
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('files', form.Value, 'binpath', t('Core binary path', '核心文件路径'), t('Executable path for the AdGuard Home binary.', 'AdGuard Home 核心可执行文件路径。')); o.placeholder = '/etc/config/adGuardConfig/AdGuardHome'; o.rmempty = false;
		o = s.taboption('files', form.Value, 'configpath', t('YAML config path', 'YAML 配置路径'), t('Main YAML configuration file edited by the YAML editor.', 'YAML 编辑器操作的主配置文件。')); o.placeholder = '/etc/config/adGuardConfig/AdGuardHome.yaml'; o.rmempty = false;
		o = s.taboption('files', form.Value, 'workdir', t('Work directory', '工作目录'), t('Directory that stores filters, statistics, sessions and query logs.', '用于保存过滤器、统计、会话和查询日志的目录。')); o.placeholder = '/etc/config/adGuardConfig/workspace'; o.rmempty = false;
		o = s.taboption('files', form.Value, 'logfile', t('Runtime log file', '运行日志文件'), t('Use syslog to follow system logs, or set a dedicated file path.', '可填 syslog 查看系统日志，也可填写独立日志文件路径。')); o.placeholder = '/tmp/AdGuardHome.log'; o.rmempty = true;
		o = s.taboption('files', form.Flag, 'verbose', t('Verbose runtime log', '详细运行日志'), t('Enable more detailed service output when troubleshooting.', '排查问题时输出更详细的运行日志。'));

		o = s.taboption('update', form.Flag, 'update', t('Check core update on startup', '启动时检查核心更新'), t('Run the updater when the service starts.', '服务启动时自动运行核心更新检查。'));
		o = s.taboption('update', form.ListValue, 'upxflag', t('UPX compression after download', '下载后 UPX 压缩'), t('Optional compression for the downloaded core binary.', '对下载后的核心文件进行可选压缩。')); o.value('', t('Disabled', '禁用')); o.value('-1', t('Fast', '快速')); o.value('-9', t('Better', '更高压缩')); o.value('--best', t('Best', '最佳')); o.value('--brute', t('Brute force', '强力压缩')); o.rmempty = true;

		o = s.taboption('rules', form.Flag, 'gfw', t('Maintain GFW rule export file', '维护 GFW 规则导出文件'), t('Generate an external GFW rule file for manual import. This no longer writes DNS entries into YAML automatically.', '生成供手动导入的 GFW 规则文件，不再自动把 DNS 条目写入 YAML。'));
		o = s.taboption('rules', form.Flag, 'gfwipset', t('Enable GFW ipset file', '启用 GFW ipset 文件'), t('Generate ipset file references for rule based routing.', '生成用于规则分流的 ipset 文件引用。'));
		o = s.taboption('rules', form.Value, 'gfwupstream', t('GFW upstream DNS', 'GFW 上游 DNS'), t('Upstream DNS used when generating the external GFW rule file for manual import.', '生成手动导入用的 GFW 规则文件时使用的上游 DNS。')); o.placeholder = 'tcp://208.67.220.220:5353'; o.rmempty = true;

		o = s.taboption('maintenance', form.MultiValue, 'upprotect', t('Keep files on system upgrade', '系统升级保留文件'), t('Files listed here are added to sysupgrade keep rules.', '这里选择的文件会加入系统升级保留列表。')); o.widget = 'checkbox'; o.value('$binpath', t('Core binary', '核心文件')); o.value('$configpath', t('Config file', '配置文件')); o.value('$logfile', t('Log file', '日志文件')); o.value('$workdir/data/sessions.db', 'sessions.db'); o.value('$workdir/data/stats.db', 'stats.db'); o.value('$workdir/data/querylog.json', 'querylog.json'); o.value('$workdir/data/filters', 'filters');
		o = s.taboption('maintenance', form.Flag, 'backup', t('Backup on shutdown', '停止服务时备份'), t('Copy selected workdir files to the backup path when stopping the service.', '停止服务时将选中的工作目录文件复制到备份路径。'));
		o = s.taboption('maintenance', form.MultiValue, 'backupfile', t('Backup workdir files', '备份工作目录文件'), t('Choose files under the work directory that should be backed up.', '选择需要备份的工作目录文件。')); o.widget = 'checkbox'; (meta.backup_choices || [ 'filters', 'stats.db', 'querylog.json', 'sessions.db' ]).forEach(function(item) { o.value(item, item); });
		o = s.taboption('maintenance', form.Value, 'backupwdpath', t('Backup path', '备份路径'), t('Destination directory for shutdown backups.', '停止服务备份的目标目录。')); o.placeholder = '/etc/config/adGuardConfig/workspace';
		o = s.taboption('maintenance', form.MultiValue, 'crontab', t('Scheduled tasks', '计划任务'), t('Legacy cron jobs managed by the init script.', '由 init 脚本维护的旧版计划任务。')); o.widget = 'checkbox'; o.value('autoupdate', t('Auto update core', '自动更新核心')); o.value('cutquerylog', t('Trim query log', '裁剪查询日志')); o.value('cutruntimelog', t('Trim runtime log', '裁剪运行日志')); o.value('autohost', t('Update IPv6 hosts', '更新 IPv6 hosts')); o.value('autogfw', t('Update GFW rule file', '更新 GFW 规则文件')); o.value('autogfwipset', t('Update GFW ipset', '更新 GFW ipset'));

		// DummyValue tools are rendered in their relevant tabs; they never write UCI.
		function tools(tab, name, build) {
			var item = s.taboption(tab, form.DummyValue, name, '');
			item.renderWidget = function() { return build(); };
		}
		tools('service', '_agh_password', passwordCard);
		tools('update', '_agh_core', function() { return updateCard(rpcError); });
		tools('update', '_agh_sources', function() { return linksCard(channelSelect, archSelect, linksBox, rpcError); });
		tools('rules', '_agh_rules', function() { return gfwCard(rpcError, yes(status.running)); });

		return m.render().then(function(formNode) {
			return applyThemeClass(E('div', { 'class': 'agh-settings agh-ui' }, [
				E('style', {}, style),
				aghui.header('settings'),
				formNode
			]), 'agh-dark');
		});
	}
});

function updateCard(rpcError) {
	var statusBox = createStatusBox(rpcError ? actionError(rpcError, t('RPC backend unavailable', 'RPC 后端不可用')) : t('Ready.', '就绪。'));
	var updateButton = E('button', { 'class': 'btn cbi-button cbi-button-action' }, t('Update', '更新'));
	var forceButton = E('button', { 'class': 'btn cbi-button agh-warning' }, t('Force update', '强制更新'));
	if (rpcError) {
		updateButton.disabled = true;
		forceButton.disabled = true;
	}
	updateButton.addEventListener('click', function() {
		runRpcAction(updateButton, statusBox, function() { return callStartUpdate(false); }, t('Update scheduled.', '已调度更新。'), t('Update failed', '启动更新失败'));
	});
	forceButton.addEventListener('click', function() {
		runRpcAction(forceButton, statusBox, function() { return callStartUpdate(true); }, t('Forced update scheduled.', '已调度强制更新。'), t('Forced update failed', '启动强制更新失败'));
	});
	return E('div', { 'class': 'agh-action agh-action-update' }, [
		actionHeader(t('Version Update', '版本更新'), t('Core Version Update', '核心版本更新')),
		E('p', {}, t('Queue a core upgrade task through rpcd and move to the log page when you need to track output.', '通过 rpcd 调度核心升级任务；需要查看执行输出时，可直接切换到运行日志页面。')),
		E('div', { 'class': 'agh-row' }, [
			updateButton,
			forceButton
		]), statusBox
	]);
}

function linksCard(channelSelect, archSelect, linksBox, rpcError) {
	var statusBox = createStatusBox(rpcError ? actionError(rpcError, t('RPC backend unavailable', 'RPC 后端不可用')) : t('Ready.', '就绪。'));
	var saveButton = E('button', { 'class': 'btn cbi-button cbi-button-action' }, t('Save source', '保存源'));
	if (rpcError)
		saveButton.disabled = true;
	saveButton.addEventListener('click', function() {
		runRpcAction(saveButton, statusBox, function() { return callSetLinks(linksBox.value, channelSelect.value, archSelect.value); }, t('Download source saved.', '下载源已保存。'), t('Saving download source failed', '保存下载源失败'));
	});
	return E('div', { 'class': 'agh-action agh-action-links' }, [
		actionHeader(t('Source', '源设置'), t('Download Sources', '下载源与架构')),
		E('p', {}, t('Choose a release channel, confirm the target architecture, or keep a fully custom source list when needed.', '可选择发布通道、确认目标架构，也可以继续维护完整的自定义下载源列表。')),
		E('div', { 'class': 'agh-row' }, [ channelSelect, archSelect, saveButton ]),
		linksBox,
		statusBox
	]);
}


function passwordCard() {
	var statusBox = createStatusBox(t('Generate a hash and it will be filled into the hash field. The plain password field will also be updated for local API access.', '生成哈希后会自动写入哈希字段，并同步更新本地 API 使用的明文密码字段。'));
	var input = E('input', { type: 'password', placeholder: t('New web password', '新的网页密码') });
	var button = E('button', { 'class': softButtonClass(), 'click': function() { ensureBcrypt().then(function() { var bcrypt = window.TwinBcrypt || (window.dcodeIO && window.dcodeIO.bcrypt); var rawPassword = input.value || ''; var hash = bcrypt && bcrypt.hashSync ? bcrypt.hashSync(rawPassword, 10) : ''; var hashTarget = document.querySelector('[data-name="hashpass"] input'); var plainTarget = document.querySelector('[data-name="password"] input'); if (hashTarget && hash) { hashTarget.value = hash; if (plainTarget) plainTarget.value = rawPassword; statusBox.textContent = t('Hash generated and both password fields were updated.', '哈希已生成，并已同步更新两个密码字段。'); } else { statusBox.textContent = t('bcrypt library unavailable or hash generation failed.', 'bcrypt 库不可用，或哈希生成失败。'); } }); } }, t('Generate hash', '生成哈希'));
	return E('div', { 'class': 'agh-action agh-action-password' }, [
		actionHeader(t('Security', '安全'), t('Password Hash Helper', '密码哈希助手')),
		E('p', {}, t('Generate a bcrypt hash for the AdGuard Home web password: it fills the hash field and syncs the local API password.', '为 AdGuard Home 后台密码生成 bcrypt 哈希，写入哈希字段并同步本地 API 密码。')),
		E('div', { 'class': 'agh-row' }, [ input, button ]),
		statusBox
	]);
}

function gfwCard(rpcError, running) {
	var statusBox = createStatusBox(rpcError ? actionError(rpcError, t('RPC backend unavailable', 'RPC 后端不可用')) : t('Ready.', '就绪。'));
	function button(action, text, label) {
		var node = E('button', { 'class': action === 'del' || action === 'ipset_del' ? 'btn cbi-button-negative' : softButtonClass() }, text);
		if (rpcError || (running && ACTION_MUTATES_GFW_YAML[action]))
			node.disabled = true;
		node.addEventListener('click', function() {
			runRpcAction(node, statusBox, function() { return callGfwAction(action); }, label, t('GFW action failed', 'GFW 操作失败'));
		});
		return node;
	}
	return E('div', { 'class': 'agh-action agh-action-gfw' }, [
		actionHeader(t('Rules', '规则'), t('GFW Rule Tools', 'GFW 规则工具')),
		E('p', {}, t('Generate or clean /etc/AdGuardHome/gfw_upstream.txt. This page never writes upstream DNS; edit it in the AdGuard Home console.', '生成或清理 /etc/AdGuardHome/gfw_upstream.txt。本页不写入上游 DNS，请在 AdGuard Home 控制台手动填写。')),
		E('div', { 'class': 'agh-button-row' }, [
			button('add', t('Generate rule file', '生成规则文件'), t('GFW rule file generated. Import it manually into YAML if needed.', 'GFW 规则文件已生成；如有需要，请手动导入 YAML。')),
			button('del', t('Delete rule file', '删除规则文件'), t('GFW rule file deleted and legacy injected YAML rules were cleaned if present.', 'GFW 规则文件已删除；若存在旧版自动注入的 YAML 规则，也已一并清理。')),
			button('import', t('Manual DNS note', '手动DNS提示'), t('Automatic upstream DNS import is disabled. Copy entries from gfw_upstream.txt in the AdGuard Home console.', '已禁用自动导入上游 DNS，请在 AdGuard Home 控制台复制 gfw_upstream.txt 中的条目。')),
			button('remove_import', t('Manual cleanup note', '手动清理提示'), t('Automatic upstream DNS removal is disabled. Edit upstream DNS in the AdGuard Home console.', '已禁用自动移除上游 DNS，请在 AdGuard Home 控制台手动编辑。')),
			button('ipset_add', t('Add ipset', '添加 ipset'), t('GFW ipset task started.', 'GFW ipset 任务已启动。')),
			button('ipset_del', t('Delete ipset', '删除 ipset'), t('GFW ipset delete task started.', 'GFW ipset 删除任务已启动。'))
		]),
		running ? E('div', { 'class': 'agh-status' }, t('ipset references cannot be changed while AdGuard Home is running; upstream DNS is edited in its console only.', 'AdGuard Home 运行中不可改 ipset 引用；上游 DNS 只在控制台中编辑。')) : '',
		statusBox
	]);
}
