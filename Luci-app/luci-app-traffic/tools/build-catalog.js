#!/usr/bin/env node
/*
 * Build the application / site / service catalogue for luci-app-traffic.
 *
 * Two upstream projects are merged, because neither is sufficient alone:
 *
 *   v2fly/domain-list-community  1.5k service files, ~38k domain keys, but the
 *                                file names are slugs ("googlefcm", "2kgames")
 *   blackmatrix7/ios_rule_script 668 per-service rule sets whose directory
 *                                names are already brand names ("XiaoHongShu",
 *                                "Epic", "AppStore") and which add the game
 *                                clients, app stores and Apple/macOS services
 *
 * Outputs (overwritten in place):
 *
 *   root/etc/traffic/apps.tsv        <name>\t<key>\tS|H
 *   root/etc/traffic/categories.tsv  <Category>\t<key>
 *   htdocs/.../traffic/icons/*.svg   brand logos, then category/protocol glyphs
 *
 * The third column is the lookup kind, which mirrors the upstream semantics:
 *   S  DOMAIN-SUFFIX / bare domain  -> longest-suffix match on the host name
 *   H  DOMAIN / full:host           -> exact host name match
 *
 * Usage:  node tools/build-catalog.js [--skip-icons] [--limit-icons N] [--cache DIR]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'root', 'etc', 'traffic');
const ICON_DIR = path.join(ROOT, 'htdocs', 'luci-static', 'resources', 'traffic', 'icons');
const CACHE = process.env.TRAFFIC_CATALOG_CACHE || path.join(os.tmpdir(), 'traffic-catalog');
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

const DLC_TARBALL = 'https://codeload.github.com/v2fly/domain-list-community/tar.gz/refs/heads/master';
const BM7_TREE = 'https://api.github.com/repos/blackmatrix7/ios_rule_script/git/trees/master?recursive=1';
const DASHBOARD_TREE = 'https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main?recursive=1';
const SIMPLE_TREE = 'https://api.github.com/repos/simple-icons/simple-icons/git/trees/develop?recursive=1';
const SELFHST_TREE = 'https://api.github.com/repos/selfhst/icons/git/trees/main?recursive=1';
/* Iconify collections used for the second, slower icon pass.  They are NOT used
 * for the first pass: widening the candidate list in one go was tried and made
 * the result *worse* (573 brand marks against 580, 1075 misses against 1051),
 * because arcticons alone contributes ~15k names that an application name can
 * almost never reach, and the flood of requests got the API to rate-limit the
 * ones that would have succeeded.  Kept for a second pass over what the first
 * pass could not resolve, where a miss costs nothing and the rate stays low. */
/* Several Iconify collections carry brand and application marks.  `logos` is
 * gilbarbara/logos (~1.9k brand marks); the rest close the gap that
 * simple-icons left when it withdrew a number of consumer brands.
 *
 * ORDER MATTERS, and it is not by quality of the set but by its STYLE.  These
 * were previously consulted in the order they are listed inside fetchBrand, and
 * arcticons came first among them - so a name arcticons happened to carry was
 * drawn as its thin-line Android outline instead of the proper brand mark that
 * selfhst or simple-icons would have supplied.  Apple Music, Youku, iQIYI,
 * Pinduoduo, Xianyu and Migu were all shipped that way, and 105 of the 863
 * icons came from arcticons in total.  Colour brand sets are therefore tried
 * first and the line-art sets last: an outline is a worse answer than a faded
 * colour mark, and both are worse than the real logo. */
const ICONIFY_COLOUR = [ 'logos', 'devicon', 'skill-icons', 'simple-icons', 'cib', 'token' ];
const ICONIFY_LINE = [ 'arcticons' ];
const ICONIFY_PREFIXES = ICONIFY_COLOUR.concat(ICONIFY_LINE);

const argv = process.argv.slice(2);
const opt = {
	skipIcons: argv.includes('--skip-icons'),
	limitIcons: 0,
	maxCategoryKeys: 0,
	cache: CACHE,
};
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === '--limit-icons') opt.limitIcons = parseInt(argv[++i], 10) || 0;
	else if (argv[i] === '--max-category-keys') opt.maxCategoryKeys = parseInt(argv[++i], 10) || 0;
	else if (argv[i] === '--cache') opt.cache = argv[++i];
}
const CACHE_DIR = opt.cache;

/* ------------------------------------------------------------------ helpers */

function log(msg) { process.stdout.write(msg + '\n'); }

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function slug(name) {
	return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpText(url, { tries = 3, token = false } = {}) {
	for (let attempt = 1; attempt <= tries; attempt++) {
		try {
			const headers = { 'user-agent': 'luci-app-traffic-catalog' };
			if (token && GH_TOKEN) headers.authorization = 'Bearer ' + GH_TOKEN;
			const res = await fetch(url, { headers });
			if (res.status === 403 || res.status === 429) throw new Error('HTTP ' + res.status + ' (rate limited?)');
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return await res.text();
		} catch (err) {
			if (attempt === tries) throw err;
			await sleep(500 * attempt);
		}
	}
}

/** GitHub tree listing, cached on disk so repeat runs do not spend API quota. */
async function ghTree(url, cacheName) {
	const file = path.join(CACHE_DIR, cacheName);
	if (fs.existsSync(file)) {
		try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* refetch */ }
	}
	if (!GH_TOKEN) log('  (提示: 未设置 GH_TOKEN，GitHub API 未认证配额仅 60 次/小时)');
	const json = await httpText(url, { token: true, tries: 4 });
	fs.writeFileSync(file, json, 'utf8');
	return JSON.parse(json);
}

/** Iconify collection index, cached on disk for a week.
 *
 *  The API is rate limited, and a 429 is the easiest possible failure to
 *  misread: fetching the collections four at a time earned a 429 for every one
 *  of them, the error was swallowed into an empty index, and the run printed a
 *  line that simply stopped after the third set.  arcticons - 15k application
 *  icons, the set that matches app names best - was never consulted and nothing
 *  said so.  Cached, this costs one request per collection per week; when the
 *  cache is warm the run is deterministic and needs no network for them. */
async function iconifyCollection(prefix) {
	const file = path.join(CACHE_DIR, `iconify-${prefix}.json`);
	if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 24 * 3600e3) {
		try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* refetch */ }
	}
	/* Two sources for the same data.  The API is the canonical one but it hands
	 * out 429s in bursts long enough to outlast 10/20/30s of retries, which left
	 * the whole run without arcticons; the @iconify-json packages on jsdelivr are
	 * the same collection and are served from a CDN that does not do that.  The
	 * names are read from `icons` as well as `uncategorized`, so both shapes
	 * yield the same membership set. */
	const SOURCES = [
		`https://api.iconify.design/collection?prefix=${prefix}`,
		`https://cdn.jsdelivr.net/npm/@iconify-json/${prefix}@latest/icons.json`,
	];
	for (const url of SOURCES) {
		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				const txt = await httpText(url, { tries: 1 });
				const idx = JSON.parse(txt);
				fs.writeFileSync(file, txt, 'utf8');
				return idx;
			} catch (err) {
				if (attempt === 2) break;
				await sleep(6000 * attempt);
			}
		}
	}
	return null;
}

/** Every icon name an Iconify collection index offers, whichever shape it has. */
function iconifyNames(idx) {
	const s = new Set();
	for (const n of (idx.uncategorized || [])) s.add(n);
	for (const arr of Object.values(idx.categories || {})) for (const n of arr) s.add(n);
	for (const n of Object.keys(idx.icons || {})) s.add(n);
	for (const n of Object.keys(idx.aliases || {})) s.add(n);
	return s;
}

/** Run `worker` over `items` with a bounded number of concurrent workers. */async function pool(items, worker, concurrency) {
	const results = new Array(items.length);
	let next = 0;
	const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await worker(items[i], i);
		}
	});
	await Promise.all(runners);
	return results;
}

/* ----------------------------------------------------- display name polishing */

/* Slugs that a mechanical "capitalise each word" transform gets wrong.  Only
 * names that a reader would notice are listed; everything else falls back to
 * the generic transform. */
const NAME_FIX = {
	'2kgames': '2K Games', '2k': '2K', '3dm': '3DM', '4chan': '4chan', '4paradigm': '4Paradigm',
	'115': '115', '12306': '12306', '1337x': '1337x', '17173': '17173', '17zuoye': '17zuoye',
	'36kr': '36Kr', '4399': '4399', '51job': '51Job', '58tongcheng': '58.com', '6park': '6park',
	'8btc': '8BTC', '9news': '9News', '9to5': '9to5',
	'adobe': 'Adobe', 'adobeactivation': 'Adobe Activation', 'alibaba': 'Alibaba',
	'alibabacloud': 'Alibaba Cloud', 'alicdn': 'AliCDN', 'aliyun': 'Alibaba Cloud', 'aliyuncs': 'Alibaba Cloud',
	'amap': 'Amap', 'anthropic': 'Anthropic', 'anthropicai': 'Anthropic', 'apple': 'Apple',
	'appledev': 'Apple Developer', 'applefirmware': 'Apple Firmware', 'applehardware': 'Apple Hardware',
	'appleid': 'Apple Account', 'applemail': 'iCloud Mail', 'applemusic': 'Apple Music',
	'applenews': 'Apple News', 'appleproxy': 'iCloud Private Relay', 'appletv': 'Apple TV',
	'appstore': 'App Store', 'autodesk': 'Autodesk', 'aws': 'AWS', 'azure': 'Microsoft Azure',
	'baidu': 'Baidu', 'baidu-ai-cloud': 'Baidu AI Cloud', 'baidutieba': 'Baidu Tieba',
	'battle': 'Battle.net', 'battlenet': 'Battle.net',
	'beats': 'Beats', 'bilibili': 'Bilibili', 'bilibiliintl': 'Bilibili (Intl)', 'bitly': 'Bitly',
	'blizzard': 'Blizzard', 'bmw': 'BMW', 'bytedance': 'ByteDance', 'cainiao': 'Cainiao',
	'cloudflare': 'Cloudflare', 'cloudfront': 'Amazon CloudFront', 'ctrip': 'Trip.com',
	'dailymotion': 'Dailymotion', 'debian': 'Debian', 'dingtalk': 'DingTalk', 'discord': 'Discord',
	'docker': 'Docker', 'didi': 'Didi', 'douyin': 'Douyin', 'dropbox': 'Dropbox',
	'ea': 'EA', 'ebay': 'eBay', 'electron': 'Electron', 'epic': 'Epic Games', 'epicgames': 'Epic Games',
	'facebook': 'Facebook', 'fastly': 'Fastly', 'figma': 'Figma', 'firebase': 'Firebase',
	'garena': 'Garena', 'github': 'GitHub', 'gitlab': 'GitLab', 'gmail': 'Gmail', 'gog': 'GOG',
	'google': 'Google', 'googleai': 'Google AI', 'googlecloud': 'Google Cloud',
	'googledeepmind': 'Google DeepMind', 'googledrive': 'Google Drive', 'googleearth': 'Google Earth',
	'googlefcm': 'Google Firebase', 'googleplay': 'Google Play', 'googlescholar': 'Google Scholar',
	'googlesearch': 'Google Search', 'googletrustservices': 'Google Trust Services',
	'googlevoice': 'Google Voice', 'googlevideo': 'YouTube', 'gopro': 'GoPro',
	'hbo': 'HBO', 'hoyoverse': 'HoYoverse', 'mihoyo': 'HoYoverse', 'huawei': 'Huawei',
	'ibm': 'IBM', 'icloud': 'iCloud', 'icloudprivaterelay': 'iCloud Private Relay',
	'instagram': 'Instagram', 'iqiyi': 'iQIYI', 'iqiyiintl': 'iQIYI (Intl)', 'itunes': 'iTunes Store',
	'jetbrains': 'JetBrains', 'jfrog': 'JFrog', 'kakaotalk': 'KakaoTalk', 'kuaishou': 'Kuaishou',
	'lenovo': 'Lenovo', 'line': 'LINE', 'linkedin': 'LinkedIn', 'microsoft': 'Microsoft',
	'microsoftedge': 'Microsoft Edge', 'mihoyo': 'HoYoverse', 'minecraft': 'Minecraft',
	'netflix': 'Netflix', 'netease': 'NetEase', 'neteasecloudmusic': 'NetEase Cloud Music',
	'neteasemusic': 'NetEase Cloud Music', 'nintendo': 'Nintendo', 'notion': 'Notion',
	'office365': 'Microsoft 365', 'onedrive': 'OneDrive', 'openai': 'OpenAI', 'openwrt': 'OpenWrt',
	'oppo': 'OPPO', 'paypal': 'PayPal', 'playstation': 'PlayStation', 'pinduoduo': 'Pinduoduo',
	'pinterest': 'Pinterest', 'pixiv': 'Pixiv', 'qq': 'QQ', 'qqmusic': 'QQ Music',
	'reddit': 'Reddit', 'riot': 'Riot Games', 'riotgames': 'Riot Games', 'roblox': 'Roblox',
	'samsung': 'Samsung', 'shein': 'SHEIN', 'shopify': 'Shopify', 'skype': 'Skype', 'slack': 'Slack',
	'snapchat': 'Snapchat', 'spotify': 'Spotify', 'steam': 'Steam', 'steamcn': 'Steam China',
	'steamcommunity': 'Steam Community', 'steampowered': 'Steam', 'taobao': 'Taobao',
	'taptap': 'TapTap', 'telegram': 'Telegram', 'temu': 'Temu', 'tencent': 'Tencent',
	'tencentcloud': 'Tencent Cloud', 'tencentvideo': 'Tencent Video', 'tiktok': 'TikTok',
	'tmall': 'Tmall', 'twitch': 'Twitch', 'twitter': 'X (Twitter)', 'ubisoft': 'Ubisoft',
	'ubuntu': 'Ubuntu', 'uc': 'UC Browser', 'vercel': 'Vercel', 'verisign': 'Verisign',
	'vmware': 'VMware', 'wechat': 'WeChat', 'wegame': 'WeGame', 'weibo': 'Weibo',
	'whatsapp': 'WhatsApp', 'wikipedia': 'Wikipedia', 'wps': 'WPS Office', 'x': 'X (Twitter)',
	'xbox': 'Xbox', 'xiaohongshu': 'Xiaohongshu', 'xiaomi': 'Xiaomi', 'yandex': 'Yandex',
	'youtube': 'YouTube', 'youtubemusic': 'YouTube Music', 'youku': 'Youku', 'zhihu': 'Zhihu',
	'zoom': 'Zoom', 'zalo': 'Zalo',
	/* Names that would collide with a protocol bucket or a category row: the
	 * page draws those as "type" rows, so an application must not share the
	 * name.  The generator also warns if a new collision appears upstream. */
	'dns': 'Public DNS', 'stun': 'STUN Servers', 'redis': 'Redis Labs',
	/* acronyms and brands the generic transform gets wrong */
	'rt': 'RT', 'att': 'AT&T', 'noip': 'No-IP', 'volcengine': 'Volcano Engine',
	'jingdong': 'JD.com', 'kingsoft': 'Kingsoft', 'gmo': 'GMO Internet',
	'wildberries': 'Wildberries', 'sber': 'Sberbank', 'tbank': 'T-Bank',
	'thescoregroup': 'theScore', 'epochmediagroup': 'Epoch Media',
	'wifimaster': 'WiFi Master', 'cibn': 'CIBN', 'hijacking': 'Hijacking',
	'ntpservice': 'NTP Service', 'bloomberg': 'Bloomberg', 'nintendo': 'Nintendo',
};

const ACRONYMS = new Set(['ai', 'api', 'app', 'aws', 'bot', 'cdn', 'crm', 'dns', 'ea', 'gpu', 'hbo', 'ibm',
	'iot', 'ip', 'isp', 'it', 'llc', 'ltd', 'nas', 'nft', 'ntp', 'os', 'pc', 'pdf', 'sdk', 'sms', 'ssd',
	'tv', 'ui', 'uk', 'us', 'usa', 'vpn', 'vps', 'vpn', 'wps', 'xml']);

/** Human-readable name for an upstream slug such as "google-play". */
function prettyName(slugName) {
	const key = String(slugName).toLowerCase();
	if (NAME_FIX[key]) return NAME_FIX[key];

	const parts = String(slugName)
		.split(/[-_.]+/)
		.filter(Boolean)
		.map(p => {
			const low = p.toLowerCase();
			if (ACRONYMS.has(low)) return low.toUpperCase();
			if (/^[0-9]+[a-z]*$/i.test(p)) return p.toUpperCase() === p ? p : p.toLowerCase();
			return p.charAt(0).toUpperCase() + p.slice(1);
		});

	return parts.join(' ') || String(slugName);
}

/* ------------------------------------------------------------ curated layer */

/* Domains whose upstream owner is a bundle rather than the product itself.
 * taobao.com is listed by domain-list-community under `alibaba` and by nothing
 * else, so without this layer 100% of Taobao traffic reads as "Alibaba".  These
 * are claimed before either source, and only for keys the upstreams genuinely
 * own (a more specific exact-host rule, such as Adobe's activation hosts, still
 * wins at lookup time). */
const CURATED = [
	/* --- China: shopping, payments, services */
	['Taobao', 'taobao.com'], ['Tmall', 'tmall.com'], ['Alipay', 'alipay.com'],
	['Alibaba', 'alibaba.com'], ['AliCDN', 'alicdn.com'], ['Alibaba Cloud', 'aliyuncs.com'],
	['Alibaba Cloud', 'aliyun.com'], ['1688', '1688.com'], ['AliExpress', 'aliexpress.com'],
	['JD.com', 'jd.com'], ['JD.com', '360buyimg.com'], ['Pinduoduo', 'pinduoduo.com'],
	['Pinduoduo', 'yangkeduo.com'], ['Meituan', 'meituan.com'], ['Meituan', 'meituan.net'],
	['Dianping', 'dianping.com'], ['Ele.me', 'ele.me'], ['Didi', 'didiglobal.com'],
	['Didi', 'xiaojukeji.com'], ['Ctrip', 'ctrip.com'], ['Trip.com', 'trip.com'],
	['Qunar', 'qunar.com'], ['12306', '12306.cn'], ['Xianyu', 'goofish.com'],
	['Suning', 'suning.com'], ['Vipshop', 'vip.com'], ['Mogu', 'mogujie.com'],
	['Xiaohongshu', 'xhscdn.com'], ['Xiaohongshu', 'xiaohongshu.com'],
	/* --- China: media, social, tools */
	['WeChat', 'weixin.qq.com', 'H'], ['WeChat', 'wechat.com'], ['WeChat', 'weixin.com'],
	['WeChat', 'wx.qq.com', 'H'], ['QQ', 'qq.com'], ['QQ', 'qpic.cn'], ['QQ', 'qlogo.cn'],
	['Tencent Video', 'v.qq.com', 'H'],
	['Tencent Cloud', 'tencentcloudapi.com'], ['Tencent Cloud', 'myqcloud.com'],
	['Tencent Cloud', 'qcloud.com'], ['Tencent', 'gtimg.cn'], ['Tencent', 'gtimg.com'],
	['Weibo', 'weibo.com'], ['Weibo', 'sinaimg.cn'], ['Weibo', 'weibo.cn'], ['Sina', 'sina.com.cn'],
	['Bilibili', 'bilibili.com'], ['Bilibili', 'bilivideo.com'], ['Bilibili', 'bilivideo.cn'],
	['Bilibili', 'hdslb.com'], ['Bilibili', 'biliapi.net'], ['Douyin', 'douyin.com'],
	['Douyin', 'douyinpic.com'], ['Douyin', 'douyinstatic.com'], ['Douyin', 'douyinvod.com'],
	['TikTok', 'tiktokcdn.com'], ['TikTok', 'tiktokv.com'], ['TikTok', 'tiktokcdn-us.com'],
	['ByteDance', 'bytedance.com'], ['ByteDance', 'byteimg.com'], ['ByteDance', 'pstatp.com'],
	['ByteDance', 'snssdk.com'], ['ByteDance', 'ixigua.com'],
	['Kuaishou', 'kuaishou.com'], ['Kuaishou', 'kwimgs.com'], ['Kuaishou', 'gifshow.com'],
	['Zhihu', 'zhihu.com'], ['Zhihu', 'zhimg.com'], ['Douban', 'douban.com'], ['Douban', 'doubanio.com'],
	['Baidu', 'baidu.com'], ['Baidu', 'bdstatic.com'], ['Baidu', 'bdimg.com'],
	['Baidu', 'hao123.com'],
	['Xiaomi', 'mi.com'], ['Xiaomi', 'miui.com'], ['Xiaomi', 'xiaomi.com'], ['Xiaomi', 'mifile.cn'],
	['Huawei', 'huawei.com'], ['Huawei', 'hicloud.com'], ['Huawei', 'dbankcdn.com'],
	['Honor', 'hihonor.com'], ['OPPO', 'oppo.com'], ['vivo', 'vivo.com.cn'],
	['NetEase', '163.com'], ['NetEase', '126.com'], ['NetEase', '126.net'],
	['NetEase Cloud Music', 'music.163.com', 'H'],
	['QQ Music', 'y.qq.com', 'H'], ['QQ Music', 'qqmusic.qq.com', 'H'],
	['Kugou', 'kugou.com'], ['Kuwo', 'kuwo.cn'], ['Ximalaya', 'ximalaya.com'],
	['Qidian', 'qidian.com'], ['Jjwxc', 'jjwxc.net'], ['Zongheng', 'zongheng.com'],
	['Youku', 'youku.com'], ['Youku', 'ykimg.com'], ['iQIYI', 'iqiyi.com'], ['iQIYI', 'qiyi.com'],
	['iQIYI', 'iqiyipic.com'], ['Mango TV', 'mgtv.com'], ['Sohu', 'sohu.com'], ['Sohu', 'sohucs.com'],
	['Huya', 'huya.com'], ['Douyu', 'douyu.com'], ['Douyu', 'douyucdn.cn'],
	['WPS Office', 'wps.cn'], ['WPS Office', 'wps.com'], ['Kingsoft', 'ksord.com'],
	['DingTalk', 'dingtalk.com'], ['Feishu', 'feishu.cn'], ['Feishu', 'larksuite.com'],
	['Alibaba', 'aliyuncdn.com'], ['Umeng', 'umeng.com'], ['Umeng', 'umengcloud.com'],
	['Getui', 'getui.com'], ['Jiguang', 'jiguang.cn'],
	/* --- Apple / macOS */
	['Apple', 'apple.com'], ['Apple', 'cdn-apple.com'], ['Apple', 'aaplimg.com'],
	['iCloud', 'icloud.com'], ['iCloud', 'icloud.com.cn'], ['iCloud', 'me.com'],
	['App Store', 'apps.apple.com', 'H'], ['App Store', 'itunes.apple.com', 'H'],
	['iTunes Store', 'itunes.com'], ['Apple Music', 'music.apple.com', 'H'],
	['Apple Music', 'mzstatic.com'], ['Apple Developer', 'developer.apple.com', 'H'],
	['Apple Firmware', 'swcdn.apple.com', 'H'], ['Apple Push', 'push.apple.com', 'H'],
	['Homebrew', 'brew.sh'], ['Setapp', 'setapp.com'], ['MacPaw', 'macpaw.com'],
	['Apple', 'apple-cloudkit.com'], ['Apple', 'mac.com'], ['Apple', 'apple.news'],
	['iCloud', 'icloud-content.com'], ['iCloud', 'cvws.icloud-content.com', 'H'],
	['Apple Maps', 'apple-mapkit.com'], ['Apple Maps', 'ls.apple.com'],
	['Apple Push', 'courier.push.apple.com', 'H'], ['Apple CDN', 'appldnld.apple.com', 'H'],
	['Apple CDN', 'iosapps.itunes.apple.com', 'H'], ['Apple TV', 'tv.apple.com', 'H'],
	['Apple Pay', 'applepay.com'], ['Beats', 'beatsbydre.com'],
	['Apple', 'mesu.apple.com', 'H'], ['Apple', 'ocsp.apple.com', 'H'],
	['Apple', 'crl.apple.com', 'H'], ['Apple', 'xp.apple.com', 'H'],
	['Apple', 'metrics.apple.com', 'H'], ['Apple', 'configuration.apple.com', 'H'],
	/* --- Google, split out of the bundle it is usually filed under */
	['Google', 'googleapis.com'], ['Google', 'gstatic.com'],
	['Google', 'googleusercontent.com'], ['Google', 'ggpht.com'], ['Google', 'gvt1.com'],
	['Google', 'gvt2.com'], ['Google', 'google-analytics.com'], ['Google', 'googletagmanager.com'],
	['Google Ads', 'googlesyndication.com'], ['Google Ads', 'doubleclick.net'],
	['Google Ads', 'googleadservices.com'], ['Google Play', 'play.googleapis.com', 'H'],
	['Google Play', 'android.clients.google.com', 'H'],
	['Gmail', 'gmail.com'], ['Gmail', 'googlemail.com'], ['Gmail', 'mtalk.google.com', 'H'],
	['Gmail', 'alt1-mtalk.google.com', 'H'], ['Gmail', 'alt2-mtalk.google.com', 'H'],
	['Google Meet', 'meet.google.com', 'H'], ['Google Photos', 'photos.google.com', 'H'],
	['Google Drive', 'drive.google.com', 'H'], ['Google Drive', 'drive.usercontent.google.com', 'H'],
	['Google Docs', 'docs.google.com', 'H'], ['Google Docs', 'sheets.google.com', 'H'],
	['Google Docs', 'slides.google.com', 'H'], ['Google Translate', 'translate.googleapis.com', 'H'],
	['Google Maps', 'maps.googleapis.com', 'H'], ['Google Maps', 'maps.gstatic.com', 'H'],
	['Google Maps', 'khms0.googleapis.com', 'H'], ['Google Maps', 'khms1.googleapis.com', 'H'],
	['Google Fonts', 'fonts.gstatic.com', 'H'], ['Google Fonts', 'fonts.googleapis.com', 'H'],
	['Google', 'ssl.gstatic.com', 'H'], ['Google', 'recaptcha.net'], ['Google', 'g.co'],
	['Google', 'firebaseinstallations.googleapis.com', 'H'], ['Google', 'app-measurement.com'],
	['Firebase', 'firebaseio.com'], ['Firebase', 'crashlytics.com'],
	['Blogger', 'blogger.com'], ['Blogger', 'blogspot.com'], ['Google', 'withgoogle.com'],
	/* --- Baidu */
	['Baidu', 'baiducontent.com'], ['Baidu', 'bdurl.net'],
	['Baidu', 'baifubao.com'], ['Baidu', 'mipcdn.com'],
	['Baidu Netdisk', 'pan.baidu.com', 'H'],
	/* Baidu's cloud platform is a product of its own, not the search brand.
	 * Leaving the BCE estate on "Baidu" gave 百度智能云 the same mark as
	 * 百度网盘, which is the one thing the two rows had to be told apart by;
	 * with them on their own name the two marks also come from their own
	 * icons instead of both resolving to baidu.svg. */
	['Baidu AI Cloud', 'baidubce.com'], ['Baidu AI Cloud', 'baidubce.cn'],
	['Baidu AI Cloud', 'baidubce.com.cn'], ['Baidu AI Cloud', 'baidubce.net.cn'],
	['Baidu AI Cloud', 'baidubcr.com'], ['Baidu AI Cloud', 'baidubos.com'],
	['Baidu AI Cloud', 'baiducloudapi.com'],
	['Baidu AI Cloud', 'baiduyuncdn.com'], ['Baidu AI Cloud', 'baiduyuncdn.cn'],
	['Baidu AI Cloud', 'baiduyuncdn.net'],
	['Baidu AI Cloud', 'baiduyundns.com'], ['Baidu AI Cloud', 'baiduyundns.cn'],
	['Baidu AI Cloud', 'baiduyundns.net'], ['Baidu AI Cloud', 'baiduyunwaf.com'],
	/* BOS and VOD are BCE products, so they carry the cloud name too */
	['Baidu AI Cloud', 'bcebos.com'], ['Baidu AI Cloud', 'bcevod.com'],
	/* The pcs domains are the netdisk family that pcs.baidu.com already belongs
	 * to, so they get the netdisk name rather than the search one. */
	['Baidu Netdisk', 'baidupcs.com'], ['Baidu Netdisk', 'baidupcs.cn'],
	['Baidu Netdisk', 'baidupcs.com.cn'], ['Baidu Netdisk', 'baidupcs.net'],
	['Baidu Netdisk', 'pcs.baidu.com', 'H'], ['Baidu Netdisk', 'd.pcs.baidu.com', 'H'],
	['Baidu Tieba', 'tieba.baidu.com', 'H'], ['Baidu Zhidao', 'zhidao.baidu.com', 'H'],
	['Baidu Wenku', 'wenku.baidu.com', 'H'], ['Baidu Map', 'map.baidu.com', 'H'],
	['Baidu', 'pos.baidu.com', 'H'], ['Baidu', 'mobads.baidu.com', 'H'],
	['Baidu', 'union.baidu.com', 'H'], ['Baidu', 'cpro.baidu.com', 'H'],
	/* --- Alibaba / Ant */
	['Alibaba', 'alibabacorp.com'], ['Alibaba', 'alibaba-inc.com'], ['Alibaba', 'aliimg.com'],
	['Alibaba', 'alimama.com'], ['Alibaba', 'tanx.com'], ['Alibaba', 'mmstat.com'],
	['Alibaba', 'cnzz.com'], ['Alibaba Cloud', 'alibabacloud.com'], ['Alibaba Cloud', 'aliyun-inc.com'],
	['Taobao', 'taobaocdn.com'], ['Taobao', 'tbcdn.cn'], ['Taobao', 'taobao.net'],
	['Tmall', 'tmall.hk'], ['Alipay', 'alipayobjects.com'], ['Alipay', 'alipaydev.com'],
	['DingTalk', 'dingtalkapps.com'],
	['Toutiao', 'toutiao.com'],
	['WeChat Official Accounts', 'mp.weixin.qq.com'],
	/* --- Tencent */
	['Tencent', 'tencent.com'], ['Tencent', 'tencent-cloud.net'], ['Tencent', 'tencentcs.com'],
	['Tencent', 'idqqimg.com'], ['Tencent', 'weixinbridge.com'], ['Tencent', 'tenpay.com'],
	['Tencent', 'dnspod.com'], ['Tencent', 'dnspod.cn'], ['Tencent', 'soso.com'],
	['Tencent Cloud', 'qcloudimg.com'], ['Tencent Cloud', 'qcloudcdn.com'],
	['Tencent Cloud', 'tencentcos.cn'], ['WeChat', 'wechatpay.cn'],
	['QQ Mail', 'qqmail.com'], ['Tencent Games', 'tencentgames.com'],
	['Tencent Meeting', 'meeting.tencent.com', 'H'], ['Tencent Docs', 'docs.qq.com', 'H'],
	['Tencent Video', 'puui.qpic.cn', 'H'], ['QQ Browser', 'qqbrowser.com'],
	/* --- Huawei / Honor */
	['Huawei', 'huaweicloud.com'], ['Huawei', 'hwclouds.com'], ['Huawei', 'myhuaweicloud.com'],
	['Huawei', 'huaweistatic.com'], ['Huawei', 'huaweipay.com'], ['Huawei', 'vmall.com'],
	['Huawei', 'harmonyos.com'], ['Huawei', 'hmscore.cn'],
	/* --- Xiaomi */
	['Xiaomi', 'mi-img.com'], ['Xiaomi', 'miui.net'], ['Xiaomi', 'mipay.com'],
	['Xiaomi', 'xiaomiyoupin.com'], ['Xiaomi', 'duokan.com'],
	/* --- ByteDance */
	['ByteDance', 'bytednsdoc.com'], ['ByteDance', 'byteoversea.com'],
	['ByteDance', 'ibytedtos.com'], ['ByteDance', 'bytedance.net'],
	['Douyin', 'douyincdn.com'], ['TikTok', 'tiktok.com'], ['TikTok', 'muscdn.com'],
	['TikTok', 'byteintlapi.com'], ['TikTok', 'ttwstatic.com'],
	['Toutiao', 'toutiaoimg.com'],
	/* --- Meta (barely present upstream), Amazon, Netflix */
	['Meta', 'facebook.com'], ['Meta', 'fbcdn.net'], ['Meta', 'fb.com'], ['Meta', 'fbsbx.com'],
	['Meta', 'facebook.net'], ['Meta', 'mcdn.net'], ['Instagram', 'instagram.com'],
	['Instagram', 'cdninstagram.com'], ['WhatsApp', 'whatsapp.com'], ['WhatsApp', 'whatsapp.net'],
	['Messenger', 'messenger.com'], ['Meta', 'threads.net'], ['Meta', 'oculus.com'],
	['Amazon', 'amazon.com'], ['Amazon', 'amazonaws.com'], ['Amazon', 'media-amazon.com'],
	['Amazon', 'ssl-images-amazon.com'], ['Amazon', 'amazon-adsystem.com'],
	['Amazon', 'images-amazon.com'], ['AWS', 'awsstatic.com'], ['AWS', 'a2z.com'],
	['Prime Video', 'primevideo.com'], ['Prime Video', 'aiv-cdn.net'],
	['Prime Video', 'aiv-delivery.net'], ['Twitch', 'twitch.tv'], ['Twitch', 'ttvnw.net'],
	['Twitch', 'jtvnw.net'],
	['Netflix', 'netflix.com'], ['Netflix', 'nflxvideo.net'], ['Netflix', 'nflximg.net'],
	['Netflix', 'nflxext.com'], ['Netflix', 'nflxso.net'], ['Netflix', 'fast.com'],
	/* --- Microsoft and the large CDNs / services that show up in every capture */
	['Microsoft', 'microsoft.com'], ['Microsoft', 'live.com'],
	['Microsoft', 'hotmail.com'], ['Microsoft', 'msn.com'], ['Microsoft', 'office.com'],
	['Microsoft', 'microsoftonline.com'], ['Microsoft', 'msftauth.net'], ['Microsoft', 'msedge.net'],
	['Microsoft', 'msecnd.net'], ['Microsoft', 'azureedge.net'],
	['Microsoft', 'windowsupdate.com'], ['Microsoft', 'msftconnecttest.com'],
	['Microsoft', 'msftncsi.com'], ['Microsoft', 'visualstudio.com'],
	['Microsoft', 'bing.com'],
	['Akamai', 'akamai.net'], ['Akamai', 'akamaiedge.net'], ['Akamai', 'akamaized.net'],
	['Akamai', 'akamaihd.net'], ['Cloudflare', 'cloudflare.com'],
	['Cloudflare', 'cloudflare-dns.com'], ['Fastly', 'fastly.net'], ['Fastly', 'fastlylb.net'],
	['GitHub', 'github.com'], ['GitHub', 'githubusercontent.com'], ['GitHub', 'githubassets.com'],
	['GitHub', 'ghcr.io'], ['Spotify', 'spotify.com'], ['Spotify', 'scdn.co'],
	['Spotify', 'spotifycdn.com'], ['Steam', 'steampowered.com'], ['Steam', 'steamstatic.com'],
	['Steam', 'steamcontent.com'], ['Epic Games', 'epicgames.com'], ['Epic Games', 'unrealengine.com'],
	['Discord', 'discord.com'], ['Discord', 'discordapp.com'], ['Discord', 'discord.gg'],
	['Telegram', 'telegram.org'], ['Telegram', 't.me'], ['Telegram', 'tdesktop.com'],
	['Zoom', 'zoom.us'], ['Zoom', 'zoom.com'], ['Slack', 'slack.com'], ['Slack', 'slack-edge.com'],
	['OpenAI', 'openai.com'], ['OpenAI', 'oaistatic.com'],
	['OpenAI', 'oaiusercontent.com'], ['Anthropic', 'anthropic.com'],
	['Adobe', 'adobe.com'], ['Adobe', 'adobedtm.com'], ['Adobe', 'adobe.io'],
	['Dropbox', 'dropbox.com'], ['Dropbox', 'dropboxstatic.com'],
	['Reddit', 'reddit.com'], ['Reddit', 'redd.it'], ['Reddit', 'redditstatic.com'],
	['LinkedIn', 'linkedin.com'], ['LinkedIn', 'licdn.com'], ['Pinterest', 'pinterest.com'],
	['Pinterest', 'pinimg.com'], ['Wikipedia', 'wikipedia.org'], ['Wikipedia', 'wikimedia.org'],
	['Vercel', 'vercel.app'], ['Netlify', 'netlify.app'],
	['Bartender', 'macbartender.com'], ['Alfred', 'alfredapp.com'], ['Sketch', 'sketch.com'],
	['Pixelmator', 'pixelmator.com'], ['Panic', 'panic.com'], ['Omni Group', 'omnigroup.com'],
	['Parallels', 'parallels.com'], ['VMware', 'vmware.com'], ['Reeder', 'reederapp.com'],
	/* --- Global: platforms and services */
	['Google', 'google.com'], ['Google', 'googleapis.com'], ['Google', 'gstatic.com'],
	['Google', 'googleusercontent.com'], ['Google', 'ggpht.com'],
	['Google', 'withgoogle.com'], ['Google', 'goo.gl'], ['Gmail', 'gmail.com'],
	['Google Play', 'play.google.com', 'H'], ['Android', 'android.com'],
	['Microsoft', 'microsoft.com'], ['Microsoft', 'msftconnecttest.com'], ['Microsoft', 'windows.com'],
	['Microsoft', 'windowsupdate.com'], ['Microsoft', 'live.com'], ['Microsoft', 'msn.com'],
	['Microsoft', 'bing.com'], ['Microsoft', 'office.com'], ['Microsoft', 'office.net'],
	['Microsoft 365', 'office365.com'], ['OneDrive', 'onedrive.com'], ['OneDrive', 'sharepoint.com'],
	['Outlook', 'outlook.com'], ['Microsoft Azure', 'azure.com'], ['Microsoft Azure', 'azurewebsites.net'],
	['Microsoft Azure', 'windows.net'], ['Microsoft Teams', 'teams.microsoft.com', 'H'],
	['LinkedIn', 'linkedin.com'], ['LinkedIn', 'licdn.com'], ['Skype', 'skype.com'],
	['Instagram', 'instagram.com'], ['Instagram', 'cdninstagram.com'],
	['WhatsApp', 'whatsapp.com'], ['WhatsApp', 'whatsapp.net'], ['Messenger', 'messenger.com'],
	['X (Twitter)', 'twitter.com'], ['X (Twitter)', 'x.com'], ['X (Twitter)', 'twimg.com'],
	['X (Twitter)', 't.co'], ['Reddit', 'reddit.com'], ['Reddit', 'redd.it'],
	['Reddit', 'redditstatic.com'], ['Reddit', 'redditmedia.com'], ['Pinterest', 'pinterest.com'],
	['Pinterest', 'pinimg.com'], ['Snapchat', 'snapchat.com'], ['Snapchat', 'sc-cdn.net'],
	['Telegram', 'telegram.org'], ['Telegram', 't.me'], ['Telegram', 'telegram.me'],
	['Discord', 'discord.com'], ['Discord', 'discordapp.com'], ['Discord', 'discordapp.net'],
	['Slack', 'slack.com'], ['Slack', 'slack-edge.com'], ['Zoom', 'zoom.us'], ['Zoom', 'zoom.com'],
	['Netflix', 'netflix.com'], ['Netflix', 'nflxvideo.net'], ['Netflix', 'nflximg.net'],
	['Netflix', 'nflxext.com'], ['Netflix', 'nflxso.net'], ['Netflix', 'fast.com'],
	['YouTube', 'youtube.com'], ['YouTube', 'ytimg.com'], ['YouTube', 'youtu.be'],
	['YouTube', 'googlevideo.com'],
	['Amazon', 'amazon.com'], ['Amazon', 'amazonaws.com'], ['Amazon', 'media-amazon.com'],
	['Amazon', 'ssl-images-amazon.com'], ['Amazon', 'a2z.org'], ['AWS', 'aws.amazon.com', 'H'],
	['Prime Video', 'primevideo.com'], ['Prime Video', 'aiv-cdn.net'],
	['Spotify', 'spotify.com'], ['Spotify', 'scdn.co'], ['Spotify', 'spotifycdn.com'],
	['SoundCloud', 'soundcloud.com'], ['SoundCloud', 'sndcdn.com'], ['Deezer', 'deezer.com'],
	['Tidal', 'tidal.com'], ['Twitch', 'twitch.tv'], ['Twitch', 'ttvnw.net'],
	['Vimeo', 'vimeo.com'], ['Vimeo', 'vimeocdn.com'], ['Dailymotion', 'dailymotion.com'],
	['Hulu', 'hulu.com'], ['Disney+', 'disneyplus.com'], ['Disney+', 'dssott.com'],
	['HBO Max', 'hbomax.com'], ['HBO', 'hbo.com'], ['Paramount+', 'paramountplus.com'],
	['Crunchyroll', 'crunchyroll.com'], ['Plex', 'plex.tv'], ['Emby', 'emby.media'],
	['GitHub', 'github.com'], ['GitHub', 'githubusercontent.com'], ['GitHub', 'githubassets.com'],
	['GitLab', 'gitlab.com'], ['GitLab', 'gitlab.io'], ['Bitbucket', 'bitbucket.org'],
	['Docker', 'docker.com'], ['Docker', 'docker.io'], ['Cloudflare', 'cloudflare.com'],
	['Cloudflare', 'cloudflare-dns.com'], ['Cloudflare', 'workers.dev'],
	['Akamai', 'akamai.net'], ['Akamai', 'akamaiedge.net'], ['Akamai', 'akamaized.net'],
	['Fastly', 'fastly.net'], ['Fastly', 'fastlylb.net'], ['jsDelivr', 'jsdelivr.net'],
	['npm', 'npmjs.org'], ['npm', 'npmjs.com'], ['PyPI', 'pypi.org'], ['Ubuntu', 'ubuntu.com'],
	['Debian', 'debian.org'], ['OpenWrt', 'openwrt.org'], ['OpenWrt', 'immortalwrt.org'],
	['OpenAI', 'openai.com'], ['OpenAI', 'oaistatic.com'], ['OpenAI', 'oaiusercontent.com'],
	['ChatGPT', 'chatgpt.com'], ['Anthropic', 'anthropic.com'], ['Claude', 'claude.ai'],
	['Hugging Face', 'huggingface.co'], ['Midjourney', 'midjourney.com'],
	['Dropbox', 'dropbox.com'], ['Dropbox', 'dropboxapi.com'], ['Box', 'box.com'],
	['Notion', 'notion.so'], ['Notion', 'notion.com'], ['Figma', 'figma.com'],
	['Canva', 'canva.com'], ['Adobe', 'adobe.com'], ['Adobe', 'adobe.io'],
	['Adobe', 'typekit.net'], ['Autodesk', 'autodesk.com'], ['JetBrains', 'jetbrains.com'],
	['JetBrains', 'jetbrains.com.cn'], ['PayPal', 'paypal.com'], ['PayPal', 'paypalobjects.com'],
	['Stripe', 'stripe.com'], ['Stripe', 'stripe.network'], ['eBay', 'ebay.com'],
	['eBay', 'ebaystatic.com'], ['Temu', 'temu.com'], ['SHEIN', 'shein.com'],
	['SHEIN', 'sheincorp.com'], ['Shopify', 'shopify.com'], ['Shopify', 'myshopify.com'],
	['Booking.com', 'booking.com'], ['Airbnb', 'airbnb.com'], ['Airbnb', 'airbnb.com.cn'],
	['Uber', 'uber.com'], ['Lyft', 'lyft.com'], ['DoorDash', 'doordash.com'],
	['Walmart', 'walmart.com'], ['Steam', 'steampowered.com'], ['Steam', 'steamstatic.com'],
	['Steam', 'steamcontent.com'], ['Steam', 'steamcommunity.com'], ['Steam', 'steam-chat.com'],
	['Epic Games', 'epicgames.com'], ['Epic Games', 'unrealengine.com'], ['Epic Games', 'epicgames.dev'],
	['Riot Games', 'riotgames.com'], ['Riot Games', 'leagueoflegends.com'], ['Riot Games', 'riotcdn.net'],
	['Blizzard', 'blizzard.com'], ['Battle.net', 'battle.net'], ['Call of Duty', 'callofduty.com'],
	['EA', 'ea.com'], ['EA', 'origin.com'], ['Ubisoft', 'ubisoft.com'], ['Ubisoft', 'ubi.com'],
	['GOG', 'gog.com'], ['Xbox', 'xbox.com'],
	['PlayStation', 'playstation.com'], ['PlayStation', 'playstation.net'],
	['Nintendo', 'nintendo.com'], ['Nintendo', 'nintendo.net'], ['Roblox', 'roblox.com'],
	/* Games, and the storefront and network hosts a console lives on.  The icon
	 * sets carry these brands; the domain lists never named them, so the traffic
	 * showed as a bare domain with a letter avatar. */
	['Fortnite', 'fortnite.com'], ['Valorant', 'playvalorant.com'], ['Valorant', 'valorant.com'],
	['League of Legends', 'leagueoflegends.co.kr'], ['League of Legends', 'lolstatic.com'],
	['Grok', 'grok.com'], ['Grok', 'x.ai'], ['Starlink', 'starlink.com'],
	['Sony', 'sony.com'], ['Sony', 'sony.net'], ['Sony', 'sonyentertainmentnetwork.com'],
	['PS Store', 'store.playstation.com', 'H'], ['PS Store', 'psn.com'],
	['PlayStation Network', 'playstationnetwork.com'],
	['Xbox Live', 'xboxlive.com'], ['Nintendo Switch', 'nintendo-europe.com'],
	['Roblox', 'rbxcdn.com'], ['Minecraft', 'minecraft.net'], ['Mojang', 'mojang.com'],
	['HoYoverse', 'hoyoverse.com'], ['HoYoverse', 'mihoyo.com'], ['HoYoverse', 'hoyolab.com'],
	['Genshin Impact', 'genshinimpact.com'], ['Garena', 'garena.com'], ['Garena', 'garenanow.com'],
	['Supercell', 'supercell.com'], ['King', 'king.com'], ['Zynga', 'zynga.com'],
	['TapTap', 'taptap.com'], ['TapTap', 'taptap.io'], ['APKPure', 'apkpure.com'],
	['APKMirror', 'apkmirror.com'], ['F-Droid', 'f-droid.org'], ['Aptoide', 'aptoide.com'],
	['Samsung Galaxy Store', 'samsungapps.com'], ['Amazon Appstore', 'amazonappstore.com'],
	['Huawei AppGallery', 'appgallery.huawei.com', 'H'], ['Xiaomi GetApps', 'app.mi.com', 'H'],
];

/* ------------------------------------------------------------- domain sanity */

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function validKey(key) {
	if (!key) return false;
	key = key.trim().toLowerCase();
	if (key.length > 253) return false;
	if (key.includes('*') || key.includes('/') || key.includes(' ')) return false;
	if (!key.includes('.')) return false;              // TLD-only rows are noise
	if (!DOMAIN_RE.test(key)) return false;
	const labels = key.split('.');
	if (labels.length < 2) return false;
	if (labels[labels.length - 1].length < 2) return false;   // bogus TLD
	return true;
}

/* =========================================================== 1. dlc reading */

const DLC_SKIP = /^(category-|tld-|geolocation-)/;
/* Not services at all: `cn` is tld-cn + geolocation-cn bundled, `private` is the
 * reserved/non-routable set (lan, localhost, invalid, example). */
const DLC_SKIP_EXACT = new Set(['cn', 'private']);

function readDlc(dataDir) {
	const files = fs.readdirSync(dataDir).filter(f => fs.statSync(path.join(dataDir, f)).isFile());
	const raw = new Map();          // file -> {suffix:Set, host:Set, include:[], regexp:n}

	for (const name of files) {
		const suffix = new Set(), host = new Set(), include = [];
		const text = fs.readFileSync(path.join(dataDir, name), 'utf8');
		for (let line of text.split('\n')) {
			line = line.replace(/\r$/, '');
			const hash = line.indexOf('#');
			if (hash >= 0) line = line.slice(0, hash);      // inline comments exist upstream
			line = line.trim();
			if (!line) continue;

			let kind = 'plain', value = line;
			const colon = line.indexOf(':');
			if (colon > 0) { kind = line.slice(0, colon).trim(); value = line.slice(colon + 1).trim(); }

			if (kind === 'include') { if (value) include.push(value); }
			else if (kind === 'full') { const k = value.toLowerCase(); if (validKey(k)) host.add(k); }
			else if (kind === 'plain' || kind === 'domain') { const k = value.toLowerCase(); if (validKey(k)) suffix.add(k); }
			/* keyword:/regexp: need substring matching the collector does not do
			 * today; they are counted and reported instead of silently dropped. */
		}
		raw.set(name, { suffix, host, include });
	}

	/* Resolve include: edges with memoisation; the graph is acyclic upstream
	 * (verified) but a cycle guard keeps a future upstream edit harmless. */
	const memo = new Map();
	function resolve(name, stack) {
		if (memo.has(name)) return memo.get(name);
		if (stack.has(name)) return { suffix: new Set(), host: new Set() };
		stack.add(name);
		const own = raw.get(name);
		const suffix = new Set(own ? own.suffix : []);
		const host = new Set(own ? own.host : []);
		for (const inc of (own ? own.include : [])) {
			if (!raw.has(inc)) continue;
			const sub = resolve(inc, stack);
			for (const v of sub.suffix) suffix.add(v);
			for (const v of sub.host) host.add(v);
		}
		stack.delete(name);
		const out = { suffix, host };
		memo.set(name, out);
		return out;
	}
	for (const name of files) resolve(name, new Set());

	return { files, raw, resolve };
}

/* =========================================================== 2. bm7 reading */

/* Directories that are routing bundles ("all of China", "everything else"),
 * or that are categories rather than a single product.  Putting ChinaMax in
 * apps.tsv would swallow every Chinese service into one row; the individual
 * services already cover those domains. */
const BM7_SKIP = new Set([
	'China', 'ChinaIPs', 'ChinaIPsBGP', 'ChinaMax', 'ChinaMaxNoIP', 'ChinaMaxNoMedia', 'ChinaNoMedia',
	'ChinaDNS', 'ChinaTest', 'Direct', 'Global', 'Lan', 'Proxy', 'ProxyLite',
	/* blocklist bundles: hundreds of thousands of tracker/ads domains that would
	 * neither fit a router nor read as an application name */
	'Advertising', 'AdvertisingLite', 'AdvertisingMiTV', 'AdvertisingTest',
	'EasyPrivacy', 'AdGuardSDNSFilter',
	/* same kind of bundle, caught by looking at what actually landed in the
	 * table: Privacy alone claimed 39,896 keys, i.e. over half of the catalogue */
	'Privacy', 'Hijacking', 'SystemOTA',
]);

/* Aggregate dirs folded into a category instead of becoming an app row.
 *
 * Deliberately absent: the blocklist bundles (Advertising*, EasyPrivacy,
 * AdGuardSDNSFilter).  They carry six figures of tracker domains and exist to
 * *block* traffic; the curated provider list in dlc's category-ads gives the
 * same "Ads"/"Tracker" answer at a thousandth of the size. */
const BM7_CATEGORY = {
	'ZhihuAds': 'Ads',
	'AdColony': 'Ads', 'Addthis': 'Ads', 'AddToAny': 'Ads', 'Marketing': 'Ads',
	'MIUIPrivacy': 'Tracker',
	'IPTVOther': 'IPTV', 'IPTVMainland': 'IPTV',
	'PrivateTracker': 'Torrent',
	'Game': 'Games', 'Crypto': 'Crypto', 'Cryptocurrency': 'Crypto', 'Mail': 'Email',
	'Speedtest': 'Speed Test', 'RemoteDesktop': 'Remote Desktop', 'Scholar': 'Education',
	'GlobalScholar': 'Education', 'GlobalMedia': 'Media', 'ChinaMedia': 'Media', 'ChinaNews': 'News',
};

async function loadBm7() {
	const cacheDir = path.join(CACHE_DIR, 'bm7');
	ensureDir(cacheDir);

	const tree = await ghTree(BM7_TREE, 'bm7-tree.json');
	const lists = tree.tree
		.filter(e => e.type === 'blob' && /^rule\/Clash\/[^/]+\/[^/]+\.list$/.test(e.path))
		.map(e => ({ dir: e.path.split('/')[2], path: e.path }));

	const services = new Map();
	const keywords = new Map();
	let downloaded = 0;

	await pool(lists, async entry => {
		const file = path.join(cacheDir, entry.dir + '.list');
		let text;
		if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
		else {
			try {
				text = await httpText('https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/' + entry.path, { tries: 3 });
				fs.writeFileSync(file, text, 'utf8');
				downloaded++;
			} catch (err) {
				log(`  ! ${entry.dir}: ${err.message}`);
				return;
			}
		}
		const suffix = new Set(), host = new Set();
		for (let line of text.split('\n')) {
			line = line.replace(/\r$/, '').trim();
			if (!line || line.startsWith('#')) continue;
			const comma = line.indexOf(',');
			if (comma < 0) continue;
			const kind = line.slice(0, comma).trim().toUpperCase();
			const value = line.slice(comma + 1).trim().split(',')[0].toLowerCase();
			if (kind === 'DOMAIN') { if (validKey(value)) host.add(value); }
			else if (kind === 'DOMAIN-SUFFIX') { if (validKey(value)) suffix.add(value); }
			else if (kind === 'DOMAIN-KEYWORD') { if (value) keywords.set(value, entry.dir); }
		}
		services.set(entry.dir, { suffix, host });
	}, 16);

	log(`  blackmatrix7: ${services.size} 个服务目录（本次下载 ${downloaded}，其余命中缓存），DOMAIN-KEYWORD ${keywords.size} 条`);
	return { services, keywords };
}

/* ======================================================= 3. category naming */

const CATEGORY_MAP = {
	'category-ads': 'Ads', 'category-ads-all': 'Ads', 'category-ads-ir': 'Ads',
	'category-public-tracker': 'Tracker',
	'category-cdn-!cn': 'CDN', 'category-cdn-cn': 'CDN',
	'category-netdisk-!cn': 'Cloud Storage', 'category-netdisk-cn': 'Cloud Storage',
	'category-social-media-!cn': 'Social', 'category-social-media-cn': 'Social',
	'category-social-media-ir': 'Social',
	'category-media': 'Media', 'category-media-cn': 'Media', 'category-media-ir': 'Media',
	'category-media-ru': 'Media', 'category-media-ru-blocked': 'Media',
	'category-games': 'Games', 'category-games-!cn': 'Games', 'category-games-cn': 'Games',
	'category-game-platforms-download': 'Games', 'category-game-accelerator-cn': 'Games',
	'category-enhance-gaming': 'Games',
	'category-ai-!cn': 'AI', 'category-ai-chat-!cn': 'AI', 'category-ai-cn': 'AI', 'category-ai-ru': 'AI',
	'category-communication': 'Communication',
	'category-ecommerce': 'Shopping', 'category-ecommerce-ru': 'Shopping',
	'category-shopping-ir': 'Shopping', 'category-retail-ru': 'Shopping',
	'category-finance': 'Finance', 'category-securities-cn': 'Finance',
	'category-bourse-ir': 'Finance', 'category-insurance-ir': 'Finance',
	'category-cryptocurrency': 'Crypto',
	'category-dev': 'Software', 'category-dev-cn': 'Software', 'category-container': 'Software',
	'category-antivirus': 'Security', 'category-password-management': 'Security',
	'category-network-security-cn': 'Security',
	'category-education-cn': 'Education', 'category-education-ir': 'Education',
	'category-education-ru': 'Education', 'category-mooc-cn': 'Education',
	'category-scholar-!cn': 'Education', 'category-scholar-cn': 'Education',
	'category-scholar-hk': 'Education', 'category-scholar-ir': 'Education',
	'category-scholar-uk': 'Education', 'category-olympiad-in-informatics': 'Education',
	'category-travel-ir': 'Travel', 'category-travel-ru': 'Travel',
	'category-automobile-cn': 'Automotive', 'category-logistics-cn': 'Logistics',
	'category-food-cn': 'Food', 'category-hospital-cn': 'Health', 'category-medicine-ru': 'Health',
	'category-vpnservices': 'VPN', 'category-proxy-tunnels': 'Proxy',
	'category-porn': 'Adult', 'category-pt': 'Torrent', 'category-ipfs': 'Torrent',
	'category-news-ir': 'News', 'category-tech-media': 'News', 'category-tech-media-ru': 'News',
	'category-forums': 'Forums', 'category-forums-ir': 'Forums', 'category-forums-ru': 'Forums',
	'category-blog-cn': 'Blog', 'category-wiki-cn': 'Wiki', 'category-browser-!cn': 'Browser',
	'category-remote-control': 'Remote Control', 'category-emby': 'Media Server',
	'category-voip': 'VoIP', 'category-urlshortner': 'URL Shortener', 'category-ddns': 'DDNS',
	'category-speedtest': 'Speed Test', 'category-ip-geo-detect': 'Geo',
	'category-doh': 'DNS', 'category-httpdns-cn': 'DNS', 'category-stun': 'STUN',
	'category-ntp': 'NTP', 'category-ntp-cn': 'NTP', 'category-ntp-jp': 'NTP',
	'category-bank-cn': 'Finance', 'category-bank-ir': 'Finance', 'category-bank-jp': 'Finance',
	'category-bank-mm': 'Finance', 'category-bank-ru': 'Finance', 'category-payment-ir': 'Finance',
	'category-betting-ru': 'Betting',
	'category-companies': 'Business', 'category-orgs': 'Business',
	'category-enterprise-query-platform-cn': 'Business', 'category-outsource-cn': 'Business',
	'category-collaborate-cn': 'Business', 'category-documents-cn': 'Software',
	'category-web-archive': 'Website', 'category-cas': 'Certificate', 'category-tm': 'Website',
	'category-consent-management': 'Tracker', 'category-mobile-repair': 'Hardware',
	'category-electronic-cn': 'Hardware', 'category-number-verification-cn': 'SMS',
	'category-anticensorship': 'Proxy', 'category-gov-ir': 'Government', 'category-gov-ru': 'Government',
	'category-hospital-cn': 'Health', 'category-acg': 'Entertainment', 'category-novel': 'Entertainment',
	'category-entertainment': 'Entertainment', 'category-entertainment-cn': 'Entertainment',
	'category-entertainment-ru': 'Entertainment', 'category-ir': 'Website', 'category-ru': 'Website',
};

/** Friendly category name for a `category-*` file, or null to fold it away. */
function categoryName(file) {
	if (CATEGORY_MAP[file]) return CATEGORY_MAP[file];
	/* Generic fallback: strip the prefix and the region suffix, then prettify. */
	let rest = file.replace(/^category-/, '').replace(/-(cn|ru|ir|jp|hk|uk|mm|us|!cn)$/, '');
	if (!rest) return null;
	const name = rest.split(/[-_]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
	return name.length > 1 ? name : null;
}

/* ================================================================ 4. icons */

/* Line-art glyphs: protocols (which have no brand) and infrastructure
 * categories (CDN, Ads, Cloud, ...).  lucide-static is ISC licensed. */
const GLYPHS = {
	'ssl-tls': 'shield-check', 'quic': 'zap', 'http': 'globe', 'dns': 'network', 'stun': 'radio',
	'rtsp': 'video', 'flv': 'clapperboard', 'icmp': 'activity', 'ssh': 'terminal', 'telnet': 'terminal',
	'ftp': 'folder', 'rdp': 'monitor', 'smb': 'hard-drive', 'mqtt': 'radio-tower', 'radius': 'key-round',
	'sip': 'phone', 'l2tp': 'shield', 'pptp': 'shield', 'ipsec': 'shield', 'mssql': 'database',
	'mysql': 'database', 'postgresql': 'database', 'redis': 'database', 'ntp': 'clock', 'snmp': 'gauge',
	'dhcp': 'router', 'email': 'mail', 'other': 'ellipsis', 'unknown': 'help-circle',
	'cdn': 'server', 'cloud': 'cloud', 'cloud-storage': 'hard-drive-download', 'ads': 'megaphone',
	'tracker': 'eye', 'search': 'search', 'social': 'users', 'media': 'film', 'video': 'film',
	'games': 'gamepad-2', 'music': 'music', 'news': 'newspaper', 'shopping': 'shopping-bag',
	'finance': 'landmark', 'crypto': 'bitcoin', 'software': 'package', 'security': 'shield-check',
	'ai': 'sparkles', 'education': 'graduation-cap', 'travel': 'plane', 'automotive': 'car',
	'logistics': 'truck', 'food': 'utensils', 'health': 'heart-pulse', 'vpn': 'shield',
	'proxy': 'shuffle', 'adult': 'eye-off', 'torrent': 'download', 'forums': 'messages-square',
	'blog': 'pen-line', 'wiki': 'book-open', 'browser': 'compass', 'remote-control': 'mouse-pointer-click',
	'remote-desktop': 'monitor-smartphone', 'media-server': 'server-cog', 'voip': 'phone-call',
	'url-shortener': 'link', 'ddns': 'refresh-cw', 'speed-test': 'gauge', 'geo': 'map-pin',
	'phone': 'smartphone', 'business': 'briefcase', 'communication': 'message-circle',
	'entertainment': 'popcorn', 'betting': 'dices', 'website': 'link', 'certificate': 'badge-check',
	'hardware': 'cpu', 'sms': 'message-square', 'government': 'building-2', 'isp': 'router',
	'android-app-download': 'smartphone', 'betting': 'dices', 'iptv': 'tv',
};

/** Slug for icon lookup: symbols that upstreams spell out are transliterated,
 *  so "Disney+" becomes disney-plus rather than a bare "disney". */
function iconSlug(name) {
	return slug(String(name).replace(/\+/g, ' plus ').replace(/&/g, ' and '));
}

/** Names whose upstream icon is filed under a slug no spelling of the name can
 *  reach.  Tried before every derived candidate, so an entry here also beats a
 *  fuzzy near-miss and saves the search pass an API call.
 *
 *  The search pass cannot cover these by itself: it gives up unless the
 *  normalised query is at least three characters long, so a numeric brand like
 *  58.com (query "58") is structurally out of its reach - which is why those
 *  names sat at the top of the missing list with hundreds of domains each.
 *
 *  Keep this short and hand-checked.  An entry that does not exist upstream is
 *  harmless - the name keeps its letter avatar, which is the honest answer - but
 *  a wrong one puts the wrong logo on a row, which is worse than no logo. */
const BRAND_ALIAS = {
	/* Every target below was checked against the sets this generator actually
	 * queries - dashboard-icons, simple-icons, selfhst/icons and the iconify
	 * collections - with tools/_probe-slugs.js, so each one exists and can be
	 * fetched.  A target that was checked and found absent is NOT recorded here:
	 * a dead alias is a comment that lies, and the name keeps its letter avatar,
	 * which is the honest answer.  simple-icons has withdrawn a number of
	 * consumer brands outright (Bloomberg, Tencent, Sohu, Durex, Bridgestone,
	 * UCloud, Qiniu, 360 were all checked and none is carried by any set now). */
	'Ctrip': 'tripdotcom',       /* the company renamed itself Trip.com */
	'XieCheng': 'tripdotcom',    /* the same company under its Chinese name */
	'Douyin': 'tiktok',          /* the same application under its Chinese name */
	'theScore': 'thescore',
	'Bestbuy': 'bestbuy',
	'Wildberries': 'wildberries',
	'Huaweicloud': 'huawei',
	'Kingsoft': 'wpsoffice',     /* Kingsoft is the company behind WPS Office */
	'Mailru': 'maildotru',
	'IFlytek': 'iflytek-input',
	'Reuters': 'reuters',
	'ChinaTelecom': 'china-telecom',
	'ICBC': 'icbc',
	'HuluUSA': 'hulu',
	'Kuaishou': 'kuaishou',
	'Genshin Impact': 'genshin-impact',
	'League of Legends': 'leagueoflegends',
	'Valorant': 'valorant',
	'Starlink': 'starlink',
	'Grok': 'grok',
	'PlayStation': 'playstation',
};

/** Public suffixes worth dropping when a row is named after a bare domain.
 *  Only the ones that actually appear in this catalogue's traffic; the list is
 *  not a suffix database and does not need to be. */
const TLDS = new Set([
	'com', 'net', 'org', 'cn', 'io', 'co', 'tv', 'me', 'info', 'biz', 'ru', 'de',
	'fr', 'uk', 'jp', 'kr', 'in', 'br', 'au', 'ca', 'xyz', 'app', 'dev', 'cloud',
	'site', 'online', 'top', 'cc', 'gg', 'to', 'us', 'eu', 'asia', 'mobi', 'name',
	'pro', 'shop', 'store', 'tech', 'live', 'news', 'media', 'group', 'club',
	'wang', 'xin', 'ltd', 'org.cn', 'com.cn', 'net.cn', 'co.uk', 'com.au',
]);

function iconCandidates(name, sourceSlug) {
	const out = [];
	const push = v => { if (v && v.length > 1 && !out.includes(v)) out.push(v); };
	const s = iconSlug(name);
	/* an explicit alias beats anything derived from the name */
	const alias = BRAND_ALIAS[name];
	if (alias) push(alias);
	/* The display name is derived from an upstream slug by NAME_FIX, and that
	 * round trip is not the identity: the icon for "AT&T" is filed upstream as
	 * atandt while the name slugs to at-and-t, and "NTP Service" came from
	 * ntpservice while the name slugs to ntp-service.  The slug the name was
	 * built from is therefore a candidate in its own right - for the glyph names
	 * it is exactly the glyph key, which is how a row like STUN Servers gets the
	 * glyph that was already in the directory. */
	/* The name's own slug comes FIRST.  It is the faithful spelling, and an
	 * upstream set that files the brand under it is the one we want; the
	 * NAME_FIX key is the fallback for names whose slug does not exist upstream
	 * (the icon for "AT&T" is filed as atandt, not at-and-t), so putting it
	 * second costs nothing there and gains a colour mark elsewhere.  Asking for
	 * the key first cost exactly that: applemusic exists in simple-icons while
	 * dashboard-icons carries apple-music, so Apple Music was drawn from the
	 * monochrome set and the faithful candidate was never tried at all. */
	push(s);
	for (const [key, disp] of Object.entries(NAME_FIX))
		if (disp === name) { push(key); break; }
	/* A row the classifier could not name is drawn as the destination it saw,
	 * which is a bare registrable name such as ctrip-it.com.  Its slug is
	 * ctrip-it-com, so no upstream set ever matches and the row keeps a letter
	 * avatar for good.  Dropping the public suffix, and then the leading label,
	 * gives the brand underneath a chance: ctrip-it-com -> ctrip-it -> ctrip. */
	const labels = s.split('-').filter(Boolean);
	if (labels.length > 1 && TLDS.has(labels[labels.length - 1])) {
		const bare = labels.slice(0, -1);
		push(bare.join('-'));
		push(bare.join(''));
		if (bare.length > 1) push(bare[0]);
	}
	push(s.replace(/-/g, ''));
	if (sourceSlug) {
		push(slug(sourceSlug));
		push(String(sourceSlug).toLowerCase().replace(/[^a-z0-9]/g, ''));
	}
	/* Last resort: the leading word.  "Apple Music" -> apple, "Baidu Tieba" ->
	 * baidu.  Only reached when nothing more specific matched, and a slightly
	 * generic logo beats a bare letter in the list. */
	const words = s.split('-').filter(w => w.length > 2);
	if (words.length > 1) push(words[0]);
	return out;
}

/** Upstream often spells a brand differently than we do: "Sina" is sinaweibo,
 *  "NetEase" is neteasecloudmusic, "Disney+" is disney-plus.  Rather than
 *  curating hundreds of aliases, allow a prefix or substring match - prefix
 *  first, then shortest, and never for very short names where the match would
 *  be meaningless. */
function fuzzyIconNames(indexes, cand,   ) {
	const hits = [];
	if (cand.length >= 3) {
		indexes.forEach(({ set, rank }) => {
			for (const n of set) if (n.startsWith(cand)) hits.push({ n, rank, exact: 1 });
		});
	}
	if (cand.length >= 4 && hits.length === 0) {
		indexes.forEach(({ set, rank }) => {
			for (const n of set) if (n.includes(cand)) hits.push({ n, rank, exact: 0 });
		});
	}
	hits.sort((a, b) => b.exact - a.exact || a.n.length - b.n.length || a.rank - b.rank);
	return hits.slice(0, 4).map(h => h.n);
}

async function buildIcons(appNames, glyphNames) {
	ensureDir(ICON_DIR);
	/* Icons kept in the repository rather than fetched.  They exist precisely for
	 * brands no upstream icon set carries - JD is the example that started this -
	 * and the file name is the application's slug(), the same key the page looks
	 * the icon up by, so dropping one in is all that is needed. */
	const LOCAL_DIR = path.join(ROOT, 'tools', 'icons-local');
	const localNames = new Set(fs.existsSync(LOCAL_DIR)
		? fs.readdirSync(LOCAL_DIR).filter(f => f.endsWith('.svg'))
		: []);
	/* Some pinned icons do have a real upstream - the Chinese bank marks come
	 * from an MIT-licensed set - and a pinned file is otherwise recorded as
	 * "shipped in this repository", which would drop that attribution the next
	 * time this script runs.  An optional sidecar carries the true source. */
	const localSource = new Map();
	const localSidecar = path.join(LOCAL_DIR, 'SOURCES.tsv');
	if (fs.existsSync(localSidecar)) {
		for (const line of fs.readFileSync(localSidecar, 'utf8').split('\n')) {
			if (!line || line.startsWith('#')) continue;
			const [file, , set, upstream] = line.split('\t');
			if (file && set) localSource.set(file, { set, upstream });
		}
	}

	/* The directory is deliberately NOT cleared before fetching.  Clearing it made
	 * the hit rate depend on the weather: a single rate-limited or timed-out
	 * request deleted an icon that had been good for months, and the run reported
	 * success anyway.  Files are now overwritten in place and only a file the
	 * current catalogue cannot name is removed, at the end.  The previous
	 * manifest is read first so that a file which survives because this run could
	 * not re-fetch it keeps the provenance that was recorded for it. */
	const prevRows = new Map();
	const prevManifest = path.join(ICON_DIR, 'SOURCES.tsv');
	if (fs.existsSync(prevManifest)) {
		for (const line of fs.readFileSync(prevManifest, 'utf8').split('\n')) {
			if (!line || line.startsWith('#')) continue;
			const file = line.split('\t')[0];
			if (file) prevRows.set(file, line);
		}
	}
	for (const f of localNames) fs.copyFileSync(path.join(LOCAL_DIR, f), path.join(ICON_DIR, f));
	if (localNames.size) log(`  本地图标: ${[...localNames].join(', ')}`);

	const [dashTree, simpleTree, selfhstTree] = await Promise.all([
		ghTree(DASHBOARD_TREE, 'dashboard-tree.json'),
		ghTree(SIMPLE_TREE, 'simple-tree.json'),
		ghTree(SELFHST_TREE, 'selfhst-tree.json').catch(() => ({ tree: [] })),
	]);
	const dashboard = new Set(dashTree.tree.filter(e => /^svg\/[^/]+\.svg$/.test(e.path))
		.map(e => e.path.slice(4, -4)));
	const simple = new Set(simpleTree.tree.filter(e => /^icons\/[^/]+\.svg$/.test(e.path))
		.map(e => e.path.slice(6, -4)));
	const selfhst = new Set(selfhstTree.tree.filter(e => /^svg\/[^/]+\.svg$/.test(e.path))
		.map(e => e.path.slice(4, -4)));
	/* Several Iconify collections carry brand and application marks.  `logos` is
	 * gilbarbara/logos (~1.9k brand marks); the rest close the gap that
	 * simple-icons left when it withdrew a number of consumer brands.
	 * `arcticons` matters most here: it is a very large set of Android *app*
	 * icons, which is exactly what an app-level view is naming.
	 *
	 * These are fetched ONE AT A TIME.  Fetching them four at a time earned a 429
	 * for every single collection, and because the failure was swallowed into an
	 * empty index the run carried on looking successful while arcticons - the
	 * 15k-icon set that matches application names best - was not consulted at
	 * all.  That is the quietest possible way to lose hundreds of icons, so a
	 * collection that still cannot be read now fails the run instead. */
	const iconify = new Map();
	const iconifyMissing = [];
	for (const p of ICONIFY_PREFIXES) {
		const idx = await iconifyCollection(p);
		if (!idx) { iconifyMissing.push(p); continue; }
		const s = iconifyNames(idx);
		if (s.size) iconify.set(p, s);
	}
	if (iconifyMissing.length)
		log(`  警告: Iconify 集合本次未参与匹配（读取失败且无缓存）: ${iconifyMissing.join(', ')}`);
	if (!iconify.size)
		throw new Error('no Iconify collection could be read, not even from cache - ' +
			'refusing to build a set that ignores every one of them');
	const logos = iconify.get('logos') || new Set();
	log(`  图标索引: dashboard-icons ${dashboard.size}，simple-icons ${simple.size}，` +
		`selfhst ${selfhst.size}，` +
		[...iconify].map(([p, s]) => `iconify:${p} ${s.size}`).join('，'));

	const cache = new Map();
	async function tryFetch(url, { mono = false } = {}) {
		try {
			let body = await httpText(url, { tries: 2 });
			if (!body.includes('<svg')) return null;
			if (mono && !/fill=/.test(body.slice(0, body.indexOf('>'))))
				body = body.replace('<svg', '<svg fill="#8b98a5"');
			return body;
		} catch (e) {
			return null;
		}
	}
	/* Ordered by how good the result looks in the list: full-colour brand marks
	 * first, monochrome last (an <img> cannot inherit the page colour, so those
	 * are pinned to the muted grey the page uses).
	 *
	 * Returns the icon and the set that supplied it.  Which set won is not
	 * trivia: the licence differs per set, and the package redistributes these
	 * files, so it is recorded for the SOURCES.tsv manifest rather than thrown
	 * away the moment the bytes arrive. */
	/* The set indexes are built from the GitHub trees, which are current, but the
	 * bytes come from CDNs, which are not necessarily: jsdelivr serves a
	 * repository at the commit it last cached, so an icon that the index lists can
	 * 404 there and the name silently stays a letter avatar.  Disney+ and
	 * Paramount+ were exactly that - present in both the index and the naming
	 * rules, yet missing on disk.  Each CDN attempt therefore falls back to the
	 * repository itself, which is the same revision the index was read from. */
	/* A set carrying a name is a promise that its bytes exist.  When they do not
	 * arrive, the pipeline used to fall through to the next, lower-quality set
	 * without a word: Apple Music is in dashboard-icons, asking for it by hand
	 * returns it, and it still shipped as a monochrome mark because a bulk run of
	 * thousands of requests got rate limited for a moment.  One more attempt
	 * after a pause is affordable here and only here - it is made only for a name
	 * a set is known to have, so a genuine miss costs nothing extra. */
	async function tryFetchKnown(url, opts) {
		const body = await tryFetch(url, opts);
		if (body) return body;
		await sleep(2000);
		return tryFetch(url, opts);
	}

	/* The set that should answer for a name, in preference order.  Comparing it
	 * with the set that did answer turns a silent degradation into a recorded
	 * one: the manifest names the set that was skipped, instead of the result
	 * looking like the only set that ever had the name. */
	function expectedSource(name) {
		if (dashboard.has(name)) return 'dashboard-icons';
		if (logos.has(name)) return 'iconify:logos';
		/* simple-icons is both an Iconify collection and a CDN set, and they are
		 * the same artwork: reporting one as a degradation of the other would be
		 * a false alarm on every icon the CDN served (vivo was the first). */
		if (simple.has(name)) return 'simple-icons';
		for (const [p, s] of iconify)
			if (ICONIFY_COLOUR.includes(p) && p !== 'simple-icons' && s.has(name)) return 'iconify:' + p;
		if (selfhst.has(name)) return 'selfhst/icons';
		for (const [p, s] of iconify)
			if (ICONIFY_LINE.includes(p) && s.has(name)) return 'iconify:' + p;
		return '';
	}

	async function fetchBrand(name) {
		if (cache.has(name)) return cache.get(name);
		let svg = null, src = '';
		if (dashboard.has(name)) {
			svg = await tryFetchKnown(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${name}.svg`)
				|| await tryFetchKnown(`https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/svg/${name}.svg`);
			if (svg) src = 'dashboard-icons';
		}
		if (!svg && logos.has(name)) {
			svg = await tryFetch(`https://api.iconify.design/logos/${name}.svg`);
			if (svg) src = 'iconify:logos';
		}
		/* colour collections only: the line-art sets are tried at the very end,
		 * after selfhst and simple-icons, because an outline is the wrong answer
		 * for a brand mark */
		for (const [p, s] of iconify) {
			if (svg) break;
			if (p === 'logos' || !ICONIFY_COLOUR.includes(p) || !s.has(name)) continue;
			svg = await tryFetch(`https://api.iconify.design/${p}/${name}.svg`);
			if (svg) src = 'iconify:' + p;
		}
		if (!svg && selfhst.has(name)) {
			svg = await tryFetchKnown(`https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${name}.svg`)
				|| await tryFetchKnown(`https://raw.githubusercontent.com/selfhst/icons/main/svg/${name}.svg`);
			if (svg) src = 'selfhst/icons';
		}
		if (!svg && simple.has(name)) {
			svg = await tryFetchKnown(`https://cdn.simpleicons.org/${name}`)
				|| await tryFetchKnown(`https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${name}.svg`, { mono: true })
				|| await tryFetchKnown(`https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${name}.svg`, { mono: true });
			if (svg) src = 'simple-icons';
		}
		/* Line art, last of all.  arcticons carries a great many application
		 * names and almost nothing else does, so it is genuinely useful - but its
		 * icons are thin outlines, and for Apple Music, Youku, iQIYI, Pinduoduo,
		 * Xianyu and Migu it was supplying one while a proper mark existed
		 * elsewhere.  It is a fallback, not a preference. */
		for (const [p, s] of iconify) {
			if (svg) break;
			if (p === 'logos' || !ICONIFY_LINE.includes(p) || !s.has(name)) continue;
			svg = await tryFetch(`https://api.iconify.design/${p}/${name}.svg`);
			if (svg) src = 'iconify:' + p;
		}
		const out = { svg, src };
		cache.set(name, out);
		return out;
	}

	const saved = [], missed = [];
	let limitHit = false;
	/* Pass one: the four broad sets, at the original concurrency.  This is what
	 * produced the icons before, so it runs untouched and keeps that result. */
	const baseIndexes = [
		{ set: dashboard, rank: 0 }, { set: logos, rank: 1 },
		{ set: selfhst, rank: 2 }, { set: simple, rank: 3 },
	];
	/* Pass two adds the app-icon collections, ranked after the brand sets so a
	 * colour brand mark is still preferred when both have the name. */
	const wideIndexes = baseIndexes.slice();
	let extraRank = 4;
	for (const [p, s] of iconify) {
		if (p === 'logos' || p === 'simple-icons') continue;
		wideIndexes.push({ set: s, rank: extraRank++ });
	}

	async function tryEntry(entry, indexes, pause) {
		if (opt.limitIcons && saved.length >= opt.limitIcons) { limitHit = true; return true; }
		/* the page looks the file up by its own slug(), which drops the symbols,
		 * so the name on disk must follow that - not iconSlug() */
		const file = slug(entry.name) + '.svg';
		if (!file) return true;
		/* an icon shipped in the repository is already the answer */
		if (localNames.has(file)) {
			const side = localSource.get(file);
			saved.push(side
				? { name: entry.name, file, from: side.upstream, src: side.set }
				: { name: entry.name, file, from: 'local', src: 'local' });
			return true;
		}
		let tried = iconCandidates(entry.name, entry.sourceSlug);
		/* If nothing matched exactly, let the upstream spelling win. */
		const fuzzy = [];
		for (const cand of tried) for (const n of fuzzyIconNames(indexes, cand)) fuzzy.push(n);
		tried = tried.concat(fuzzy);
		for (const cand of tried) {
			const got = await fetchBrand(cand);
			if (!got.svg) {
				/* the second pass paces itself: it is the pass that can trip the
				 * API's rate limit, and it only runs on what pass one missed */
				if (pause) await sleep(pause);
				continue;
			}
			fs.writeFileSync(path.join(ICON_DIR, file), got.svg.trim().replace(/\r/g, ''), 'utf8');
			saved.push({ name: entry.name, file, from: cand, src: got.src });
			return true;
		}
		/* Nothing matched.  A miss that should have been a hit - the name is in the
		 * catalogue and an upstream set does carry the icon - is otherwise
		 * indistinguishable from a name no set carries, which is how Genshin
		 * Impact went unexplained: a catalogue name, an arcticons icon for it, and
		 * no file on disk.  Set EXPLAIN_ICONS=1 to have every miss name the sets
		 * that hold one of its candidates. */
		if (process.env.EXPLAIN_ICONS) {
			const near = [];
			for (const cand of tried) {
				if (dashboard.has(cand)) near.push('dashboard-icons:' + cand);
				if (logos.has(cand)) near.push('iconify:logos:' + cand);
				for (const [p, s] of iconify)
					if (p !== 'logos' && s.has(cand)) near.push('iconify:' + p + ':' + cand);
				if (selfhst.has(cand)) near.push('selfhst/icons:' + cand);
				if (simple.has(cand)) near.push('simple-icons:' + cand);
			}
			log(`  miss "${entry.name}" tried [${tried.join(', ')}] ` +
				(near.length ? `upstream has: ${near.join(', ')}` : 'upstream has none of these'));
		}
		return false;
	}

	await pool(appNames, async entry => {
		if (await tryEntry(entry, baseIndexes, 0)) return;
		missed.push(entry);
	}, 6);

	/* Second pass: only the ones pass one could not resolve, over the wider name
	 * index, slowly.  It keeps the entries, not their names, because the third
	 * pass needs `sourceSlug` to build its candidates - rebuilding this as names
	 * is what made that pass write every result to slug(undefined). */
	log(`  第一轮: 命中 ${saved.length}，未命中 ${missed.length} -> 第二轮（含 arcticons/cib/token，低并发）`);
	const firstPassMissed = missed.length;
	const afterWide = [];
	await pool(missed, async entry => {
		if (await tryEntry(entry, wideIndexes, 90)) return;
		afterWide.push(entry);
	}, 2);
	missed.length = 0;
	for (const e of afterWide) missed.push(e);
	log(`  第二轮: 补上 ${firstPassMissed - missed.length} 个，仍未命中 ${missed.length} 个`);

	/* Third pass: ask the search index instead of requiring a candidate to match
	 * an existing name exactly.  The two passes above can only find an icon whose
	 * name is already derivable from the application name, and that is exactly
	 * what left ~1050 of them without a mark - the collections do hold many of
	 * those apps (arcticons alone names thousands) but the name is not reachable
	 * by slugging.  Search is a different index, so it runs last and slowly.
	 *
	 * A hit is only accepted when the icon's own name matches the query.  Without
	 * that check a search for a short name returns whatever is popular, which
	 * would silently put the wrong logo on a row - worse than a letter avatar. */
	const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
	async function searchIcon(query) {
		const want = norm(query);
		/* Two characters are enough.  The acceptance test below requires the
		 * icon's own name to normalise to exactly this string - or, for longer
		 * queries, to contain it - so a short query cannot return something
		 * unrelated.  The three-character floor is what made numeric brands
		 * unreachable: "58.com" searches for "58" and was refused before the
		 * request was even made, which is why 58.com, 360 and 17173 sat at the
		 * top of the missing list with hundreds of domains each. */
		if (want.length < 2) return null;
		try {
			const txt = await httpText('https://api.iconify.design/search?limit=12&query=' +
				encodeURIComponent(query), { tries: 2 });
			const j = JSON.parse(txt);
			if (!j || !Array.isArray(j.icons)) return null;
			for (const full of j.icons) {
				const cut = String(full).indexOf(':');
				if (cut < 1) continue;
				const prefix = String(full).slice(0, cut);
				const name = String(full).slice(cut + 1);
				const got = norm(name);
				if (got === want || (want.length >= 5 && (got.includes(want) || want.includes(got))))
					return { prefix, name };
			}
		} catch (e) { /* a failed search is just a miss */ }
		return null;
	}

	const searchMissed = [];
	let searched = 0;
	await pool(missed.slice(), async entry => {
		/* the first word is the brand in almost every name here ("NetEase Cloud
		 * Music" -> netease, "Xiaohongshu" -> xiaohongshu), and short queries are
		 * what a prefix-based search index answers well */
		let q = slug(entry.name).split('-')[0];
		if (q.length < 3) q = slug(entry.name);
		const hit = await searchIcon(q);
		await sleep(120);
		if (!hit) { searchMissed.push(entry.name); return; }
		const svg = await tryFetch(`https://api.iconify.design/${hit.prefix}/${hit.name}.svg`);
		if (!svg) { searchMissed.push(entry.name); return; }
		const file = slug(entry.name) + '.svg';
		if (!file) return;
		fs.writeFileSync(path.join(ICON_DIR, file), svg.trim().replace(/\r/g, ''), 'utf8');
		saved.push({ name: entry.name, file, from: hit.prefix + ':' + hit.name,
			src: 'iconify:' + hit.prefix });
		searched++;
	}, 2);
	missed.length = 0;
	for (const n of searchMissed) missed.push(n);
	log(`  第三轮(search): 补上 ${searched} 个，仍未命中 ${missed.length} 个`);

	const glyphSaved = [], glyphMissed = [];
	for (const [key, lucide] of Object.entries(GLYPHS)) {
		if (!glyphNames.has(key)) continue;
		try {
			let svg = await httpText(`https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${lucide}.svg`);
			if (!svg.includes('<svg')) throw new Error('no svg');
			svg = svg.replace(/stroke="currentColor"/g, 'stroke="#8b98a5"')
				.replace(/(<svg[^>]*?)\s+width="[^"]*"/, '$1')
				.replace(/(<svg[^>]*?)\s+height="[^"]*"/, '$1');
			if (!svg.includes('viewBox')) svg = svg.replace('<svg', '<svg viewBox="0 0 24 24"');
			fs.writeFileSync(path.join(ICON_DIR, key + '.svg'), svg.trim(), 'utf8');
			glyphSaved.push(key);
		} catch (err) {
			glyphMissed.push(key);
		}
	}

	/* Some application names in the catalogue are not brands at all: the
	 * classifier names a row "STUN Servers" or "NTP Service" when the traffic is
	 * that protocol, and a brand logo would be the wrong answer for those rows.
	 * Their glyph already exists under the category key, but the page looks an
	 * icon up by the application's own slug, so the glyph is published under that
	 * slug too.  STUN Servers carries more domains than any other name in the
	 * catalogue - 350 of them - and it was showing a letter avatar while its
	 * glyph sat in the directory beside it. */
	const NAME_TO_GLYPH = {
		'STUN Servers': 'stun',
		'NTP Service': 'ntp',
	};
	let glyphAliased = 0;
	for (const [appName, key] of Object.entries(NAME_TO_GLYPH)) {
		const from = path.join(ICON_DIR, key + '.svg');
		const sl = slug(appName);
		if (!sl || !fs.existsSync(from)) continue;
		fs.copyFileSync(from, path.join(ICON_DIR, sl + '.svg'));
		saved.push({ name: appName, file: sl + '.svg', from: key, src: 'lucide-static' });
		glyphAliased++;
	}
	if (glyphAliased) log(`  类别名沿用线稿: ${glyphAliased} 个`);

	/* ---- provenance manifest ---------------------------------------------
	 * The package redistributes every one of these files and they come from six
	 * different projects whose licences are not the same, so "icons belong to
	 * their owners" in the README cannot answer "under what terms is this file
	 * here".  The generator knows the answer per icon while it is fetching, and
	 * forgets it the moment it exits - so it writes it down.
	 *
	 * The licence is filled in only where the upstream project states one
	 * plainly.  Everywhere else the row says so and gives the URL to check
	 * instead of guessing: a wrong licence in a manifest is worse than an
	 * honest "check upstream". */
	const SET_INFO = {
		'dashboard-icons': ['see upstream LICENSE',
			'https://github.com/homarr-labs/dashboard-icons/blob/main/LICENSE'],
		'selfhst/icons': ['see upstream LICENSE',
			'https://github.com/selfhst/icons/blob/main/LICENSE'],
		'simple-icons': ['CC0-1.0 (trademarks: see DISCLAIMER.md)',
			'https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md'],
		'lucide-static': ['ISC', 'https://github.com/lucide-icons/lucide/blob/main/LICENSE'],
		'local': ['shipped in this repository (marks of their owners)',
			'tools/icons-local in the luci-app-traffic source tree'],
		'bank-logos': ['MIT (trademarks remain with the banks)',
			'https://github.com/icongo/bank-logos'],
		/* Pinned icons whose bytes came from somewhere that is not an icon set.
		 * Without an entry here the sidecar still records the upstream, but the
		 * licence column falls back to the iconify wording and calls a public
		 * domain Commons file part of a collection it has nothing to do with. */
		'wikimedia-commons': ['see the licence on the file page (public domain for CCTVNewLogo)',
			'https://commons.wikimedia.org/'],
		'seeklogo': ['seeklogo: reference use only, not an open licence (trademark of the owner)',
			'https://seeklogo.com/'],
		'svglogo': ['MIT', 'https://github.com/HeyHuazi/SVGLOGO'],
	};
	function setInfo(src) {
		if (!src) return ['unknown', ''];
		if (SET_INFO[src]) return SET_INFO[src];
		const prefix = String(src).replace(/^iconify:/, '');
		return ['see the collection licence', `https://icon-sets.iconify.design/${prefix}/`];
	}
	const rows = ['# Generated by tools/build-catalog.js - do not edit by hand.',
		'# file\tapplication\tsource set\tupstream slug\tlicence\tsource URL\tdegraded'];
	/* A row whose source set is not the set that should have answered is a
	 * degraded icon: the name is real and a better mark exists, but the bytes did
	 * not arrive.  Naming the skipped set here is what makes that visible - the
	 * icon still looks like a normal result otherwise, which is how Apple Music
	 * was drawn as a monochrome mark for weeks without anyone noticing. */
	const upstream = new Set(['dashboard-icons', 'iconify:logos', 'selfhst/icons', 'simple-icons',
		...ICONIFY_PREFIXES.map(p => 'iconify:' + p)]);
	for (const e of saved) {
		const [lic, url] = setInfo(e.src);
		let note = '';
		if (e.src && upstream.has(e.src)) {
			const want = expectedSource(e.name);
			if (want && want !== e.src) note = 'degraded: ' + want + ' has it';
		}
		rows.push([e.file, e.name, e.src || 'unknown', e.from, lic, url, note].join('\t'));
	}
	for (const key of glyphSaved)
		rows.push([key + '.svg', key, 'lucide-static', GLYPHS[key], ...SET_INFO['lucide-static'], ''].join('\t'));

	/* Files this run did not produce but that the catalogue can still name keep
	 * their place: a fetch may fail for reasons that have nothing to do with the
	 * icon, and deleting the file would turn a transient outage into a permanently
	 * missing logo.  Only a file no name maps to - a leftover from an older
	 * catalogue - is removed. */
	const produced = new Set([
		...saved.map(e => e.file),
		...glyphSaved.map(k => k + '.svg'),
		...localNames,
	]);
	/* buildIcons is handed {name, sourceSlug} entries, not bare names.  Reading
	 * them as names produced a set holding one junk entry ("object-object.svg"),
	 * so the first version of this clean deleted 56 icons the catalogue still
	 * names - Reuters, Youku, iQIYI, Starlink, UCloud and others.  Accept both
	 * shapes so the check cannot go blind again. */
	const knownFiles = new Set([
		...appNames.map(e => slug(typeof e === 'string' ? e : e.name) + '.svg'),
		...Object.keys(GLYPHS).map(k => k + '.svg'),
		...Object.values(NAME_TO_GLYPH).map(k => k + '.svg'),
	]);
	let carried = 0, dropped = 0;
	for (const f of fs.readdirSync(ICON_DIR)) {
		if (!f.endsWith('.svg') || produced.has(f)) continue;
		/* A file the previous manifest already recorded is kept even when this run
		 * could not fetch it again: the manifest is the record of what legitimately
		 * ships, so without this a flaky request silently deletes a logo and the
		 * hit rate moves with the weather.  Only a file that nothing has ever
		 * recorded is removed. */
		if (knownFiles.has(f) || prevRows.has(f)) {
			carried++;
			/* A carried row is the previous manifest's line, which may predate the
			 * degraded column; padded so the table stays rectangular.  A ragged
			 * TSV is not fatal but it is exactly the kind of "close enough"
			 * that makes a later column-shift bug invisible. */
			const carriedRow = prevRows.get(f);
			rows.push(carriedRow
				? (carriedRow.split('\t').length < 7 ? carriedRow + '\t' : carriedRow)
				: [f, '', 'unknown', '', 'carried over; provenance not recorded', '', ''].join('\t'));
			continue;
		}
		fs.unlinkSync(path.join(ICON_DIR, f));
		dropped++;
	}
	if (carried || dropped) log(`  保留未重新抓取: ${carried} 个，清理无用: ${dropped} 个`);

	fs.writeFileSync(path.join(ICON_DIR, 'SOURCES.tsv'), rows.join('\n') + '\n', 'utf8');
	log(`  来源清单: SOURCES.tsv（${rows.length - 2} 条）`);

	const bytes = fs.readdirSync(ICON_DIR).filter(f => f.endsWith('.svg'))
		.reduce((sum, f) => sum + fs.statSync(path.join(ICON_DIR, f)).size, 0);

	return { saved, missed, glyphSaved, glyphMissed, bytes, dashboard: dashboard.size, simple: simple.size, limitHit };
}

/* =================================================================== main */

async function main() {
	ensureDir(CACHE_DIR);
	ensureDir(DATA_DIR);

	log('[1/5] domain-list-community');
	const dlcDir = path.join(CACHE_DIR, 'dlc');
	const dataDir = path.join(dlcDir, 'domain-list-community-master', 'data');
	if (!fs.existsSync(dataDir)) {
		const tgz = path.join(CACHE_DIR, 'dlc.tgz');
		if (!fs.existsSync(tgz)) {
			const buf = Buffer.from(await (await fetch(DLC_TARBALL)).arrayBuffer());
			fs.writeFileSync(tgz, buf);
		}
		ensureDir(dlcDir);
		const res = spawnSync('tar', ['-xzf', tgz, '-C', dlcDir], { stdio: 'inherit' });
		if (res.status !== 0) throw new Error('tar 解压失败');
	}
	const dlc = readDlc(dataDir);
	log(`  ${dlc.files.length} 个服务文件`);

	log('[2/5] blackmatrix7/ios_rule_script');
	const bm7 = await loadBm7();

	/* ---- apps: name -> keys.  Smaller rule sets are consumed first so that a
	 *      leaf service (google-play) wins over the umbrella that includes it
	 *      (google) when both claim a domain. */
	log('[3/5] 合并应用目录');
	const appSuffix = new Map();   // key -> name
	const appHost = new Map();
	const perName = new Map();     // name -> {sourceSlug, suffix, host}
	const nameSource = new Map();  // name -> curated|bm7|dlc, for tie-breaking

	function claim(map, key, name, sourceSlug, source) {
		if (map.has(key)) return false;
		map.set(key, name);
		if (!perName.has(name)) perName.set(name, { sourceSlug, suffix: 0, host: 0 });
		if (source && !nameSource.has(name)) nameSource.set(name, source);
		return true;
	}

	const bm7Entries = [...bm7.services.entries()]
		.filter(([dir]) => !BM7_SKIP.has(dir) && !BM7_CATEGORY[dir])
		.sort((a, b) => (a[1].suffix.size + a[1].host.size) - (b[1].suffix.size + b[1].host.size) || a[0].localeCompare(b[0]));

	/* The curated layer goes first: it exists exactly for the keys whose
	 * upstream owner is a bundle (taobao.com is listed under `alibaba` and
	 * nowhere else).  A more specific exact-host rule still wins at lookup
	 * time, so claiming here does not flatten Adobe's activation hosts. */
	let curated = 0;
	for (const [name, key, kind] of CURATED) {
		const k = key.toLowerCase();
		if (!validKey(k)) { log(`  ! 跳过无效的 curated 键: ${key}`); continue; }
		if (kind === 'H') { if (claim(appHost, k, name, 'curated', 'curated')) curated++; }
		else if (claim(appSuffix, k, name, 'curated', 'curated')) curated++;
	}
	log(`  curated 优先层: ${curated} 个键`);

	for (const [dir, set] of bm7Entries) {
		const name = prettyName(dir);
		for (const k of set.host) claim(appHost, k, name, dir, 'bm7');
		for (const k of set.suffix) claim(appSuffix, k, name, dir, 'bm7');
	}

	const dlcEntries = dlc.files
		.filter(f => !DLC_SKIP.test(f) && !DLC_SKIP_EXACT.has(f))
		.map(f => [f, dlc.resolve(f, new Set())])
		.sort((a, b) => (a[1].suffix.size + a[1].host.size) - (b[1].suffix.size + b[1].host.size) || a[0].localeCompare(b[0]));
	for (const [file, set] of dlcEntries) {
		const name = prettyName(file);
		for (const k of set.host) claim(appHost, k, name, file, 'dlc');
		for (const k of set.suffix) claim(appSuffix, k, name, file, 'dlc');
	}

	/* Two upstreams often carry the same brand spelled differently ("AcFun" in
	 * blackmatrix7, "Acfun" from the dlc slug).  Left alone that splits one
	 * service across two rows - and two icons - so names that share a slug are
	 * folded into the best-spelled variant. */
	function nameScore(n) {
		const src = nameSource.get(n) || 'dlc';
		const rank = src === 'curated' ? 3 : src === 'bm7' ? 2 : 1;
		const inner = (n.slice(1).match(/[A-Z]/g) || []).length;
		return rank * 1000 + inner * 10 + n.length;
	}
	const bestBySlug = new Map();
	for (const n of new Set([...appSuffix.values(), ...appHost.values()])) {
		const s = slug(n);
		if (!s) continue;
		const cur = bestBySlug.get(s);
		if (!cur || nameScore(n) > nameScore(cur)) bestBySlug.set(s, n);
	}
	const canonical = new Map();
	let merged = 0;
	for (const n of new Set([...appSuffix.values(), ...appHost.values()])) {
		const best = bestBySlug.get(slug(n));
		if (best && best !== n) { canonical.set(n, best); merged++; }
	}
	if (merged) {
		for (const [k, v] of appSuffix) if (canonical.has(v)) appSuffix.set(k, canonical.get(v));
		for (const [k, v] of appHost) if (canonical.has(v)) appHost.set(k, canonical.get(v));
		log(`  合并同 slug 的不同拼写: ${merged} 个名称 -> ${[...new Set(canonical.values())].length}`);
	}

	/* ---- categories: only for keys no application claimed (apps come first
	 *      in the attribution ladder, so anything else would be dead weight). */
	const catSuffix = new Map();
	const catHost = new Map();
	function addCategory(cat, set) {
		for (const k of set.host) if (!appHost.has(k) && !appSuffix.has(k) && !catHost.has(k)) catHost.set(k, cat);
		for (const k of set.suffix) if (!appHost.has(k) && !appSuffix.has(k) && !catSuffix.has(k)) catSuffix.set(k, cat);
	}
	for (const file of dlc.files) {
		if (!file.startsWith('category-')) continue;
		const cat = categoryName(file);
		if (cat) addCategory(cat, dlc.resolve(file, new Set()));
	}
	for (const [dir, cat] of Object.entries(BM7_CATEGORY)) {
		if (bm7.services.has(dir)) addCategory(cat, bm7.services.get(dir));
	}

	/* categories.tsv has no kind column: the collector loads every row into one
	 * suffix table.  A key therefore has to appear exactly once, and an exact
	 * host rule (more specific) is the one worth keeping. */
	const catMerged = new Map();
	for (const [k, c] of catSuffix) catMerged.set(k, c);
	for (const [k, c] of catHost) catMerged.set(k, c);

	/* Blocklists such as EasyPrivacy carry six figures of tracker domains.  They
	 * exist to *block* traffic, not to label it, and 300k rows would dwarf the
	 * application table the collector reloads on every poll.  Keep the shallow
	 * keys (the registrable-looking ones a reader recognises) and drop the deep
	 * CDN noise. */
	const perCategory = new Map();
	for (const [k, c] of catMerged) {
		if (!perCategory.has(c)) perCategory.set(c, []);
		perCategory.get(c).push(k);
	}
	const catSizes = [...perCategory.entries()].map(([c, ks]) => [c, ks.length]).sort((a, b) => b[1] - a[1]);
	log('  类别规模（前 15）: ' + catSizes.slice(0, 15).map(([c, n]) => `${c}=${n}`).join(' '));

	if (opt.maxCategoryKeys > 0) {
		let dropped = 0;
		for (const [c, ks] of perCategory) {
			if (ks.length <= opt.maxCategoryKeys) continue;
			ks.sort((a, b) => a.split('.').length - b.split('.').length ||
				a.length - b.length || a.localeCompare(b));
			for (const k of ks.slice(opt.maxCategoryKeys)) { catMerged.delete(k); dropped++; }
		}
		if (dropped) log(`  类别上限 ${opt.maxCategoryKeys}/类：丢弃 ${dropped} 个深层域名`);
	}

	/* ---- write the tables */
	const appsRows = [];
	for (const [k, n] of appSuffix) appsRows.push([n, k, 'S']);
	for (const [k, n] of appHost) appsRows.push([n, k, 'H']);
	appsRows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

	const catRows = [];
	for (const [k, c] of catMerged) catRows.push([c, k]);
	catRows.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

	const header = kind => [
		`# ${kind} catalogue for luci-app-traffic - generated by tools/build-catalog.js`,
		'# Do not edit by hand: re-run the generator to refresh it.',
		'',
	].join('\n');

	fs.writeFileSync(path.join(DATA_DIR, 'apps.tsv'),
		header('Application') + appsRows.map(r => r.join('\t')).join('\n') + '\n', 'utf8');
	fs.writeFileSync(path.join(DATA_DIR, 'categories.tsv'),
		header('Category') + catRows.map(r => r.join('\t')).join('\n') + '\n', 'utf8');

	const appNames = [...new Set(appsRows.map(r => r[0]))].sort();
	const catNames = [...new Set(catRows.map(r => r[0]))].sort();

	log(`  应用: ${appNames.length} 个名称 / ${appSuffix.size} 后缀键 + ${appHost.size} 精确主机键`);
	log(`  类别: ${catNames.length} 个 / ${catMerged.size} 个键`);
	log(`  categories: ${catNames.join(', ')}`);

	/* The page draws category and protocol rows as "type" rows.  An application
	 * that shares one of those names would be drawn the same way, so surface it
	 * here rather than in a screenshot later. */
	const typeNames = new Set([...catNames, 'SSL/TLS', 'QUIC', 'HTTP', 'DNS', 'STUN', 'RTSP', 'FLV',
		'Email', 'SSH', 'Telnet', 'FTP', 'RDP', 'SMB', 'MQTT', 'RADIUS', 'SIP', 'L2TP', 'PPTP',
		'IPSec', 'MSSQL', 'MySQL', 'PostgreSQL', 'Redis', 'NTP', 'SNMP', 'DHCP', 'ICMP', 'Other']);
	const clashes = appNames.filter(n => typeNames.has(n));
	if (clashes.length) log(`  ! 名称与类别/协议桶冲突（会在页面上被画成类型行）: ${clashes.join(', ')}`);
	else log('  名称冲突检查: 无');

	log('[4/5] 图标');
	let iconInfo = null;
	if (opt.skipIcons) log('  (--skip-icons)');
	else {
		const glyphNeeded = new Set([...Object.keys(GLYPHS)].filter(k => catNames.some(c => slug(c) === k)));
		for (const b of ['ssl-tls', 'quic', 'http', 'dns', 'stun', 'rtsp', 'flv', 'icmp', 'ssh', 'telnet',
			'ftp', 'rdp', 'smb', 'mqtt', 'radius', 'sip', 'l2tp', 'pptp', 'ipsec', 'mssql', 'mysql',
			'postgresql', 'redis', 'ntp', 'snmp', 'dhcp', 'other', 'unknown']) glyphNeeded.add(b);
		iconInfo = await buildIcons(
			appNames.map(n => ({ name: n, sourceSlug: (perName.get(n) || {}).sourceSlug })),
			glyphNeeded);
		log(`  品牌图标 ${iconInfo.saved.length} 个，字形 ${iconInfo.glyphSaved.length} 个，共 ${(iconInfo.bytes / 1024).toFixed(0)} KiB`);
		log(`  无上游图标（保留字母头像）: ${iconInfo.missed.length} 个`);
	}

	log('[5/5] 结果');
	const sizeOf = f => (fs.statSync(path.join(DATA_DIR, f)).size / 1024).toFixed(0) + ' KiB';
	log(`  apps.tsv       ${appsRows.length} 行, ${sizeOf('apps.tsv')}`);
	log(`  categories.tsv ${catRows.length} 行, ${sizeOf('categories.tsv')}`);
	if (bm7.keywords.size) log(`  未使用: blackmatrix7 DOMAIN-KEYWORD ${bm7.keywords.size} 条（采集器不做子串匹配）`);

	const report = {
		generated: new Date().toISOString(),
		apps: { names: appNames.length, suffix: appSuffix.size, host: appHost.size },
		categories: { names: catNames, keys: catMerged.size },
		icons: iconInfo ? { brands: iconInfo.saved.length, glyphs: iconInfo.glyphSaved.length, bytes: iconInfo.bytes, missed: iconInfo.missed.length } : null,
	};
	fs.writeFileSync(path.join(CACHE_DIR, 'report.json'), JSON.stringify(report, null, 1), 'utf8');
	log(`  报告: ${path.join(CACHE_DIR, 'report.json')}`);
}

main().catch(err => { console.error('FAILED:', err && err.stack || err); process.exit(1); });
