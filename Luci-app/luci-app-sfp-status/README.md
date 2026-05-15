# luci-app-sfp-status

适用于 OpenWrt 24.10 的 LuCI 应用，用于读取一个或多个 SFP 模块的 DOM 遥测信息，并在状态 > 概览中通过原生概览页组件展示。

## 主题兼容性

该组件和页面使用标准 LuCI 结构类，例如 cbi-section、table、tr、td 和 ifacebadge，因此能够遵循当前 LuCI 的布局模型，并在无需页面专用 CSS 覆盖的前提下良好适配 luci-theme-argon。

## 数据来源

后端通过 ethtool 读取 SFP 信息：

- ethtool -m &lt;ifname&gt;：读取 DOM 遥测和模块信息。
- ethtool &lt;ifname&gt;：读取链路状态和速率信息。

如果未配置接口，后端会自动探测所有可读取 SFP DOM 数据的网络设备，并在概览页逐个展示。

## 文件说明

- root/usr/libexec/rpcd/luci.sfp-status：rpcd 后端，提供 luci.sfp-status 的 ubus 方法。
- htdocs/luci-static/resources/view/status/include/15_sfp.js：概览页组件。
- root/usr/share/rpcd/acl.d/luci-app-sfp-status.json：LuCI ACL 只读权限定义。

## 构建

将该软件包目录放入 LuCI feed，或放到 feeds/luci/applications/ 目录下，然后按常规 OpenWrt 流程进行构建：

```sh
make menuconfig
make package/feeds/luci/luci-app-sfp-status/compile V=s
```

## GitHub Actions 编译

仓库已包含 GitHub Actions 工作流 [main.yml](../.github/workflows/main.yml)，可用于自动编译此插件。

工作流做的事情如下：

- 默认下载适用于 ARMv8 设备的 OpenWrt 24.10.0 官方 SDK（mediatek/filogic）。
- 将当前仓库中的 luci-app-sfp-status 挂载到 SDK 的 feeds/luci/applications/ 目录，并显式注册到 package/feeds/luci。
- 安装 luci-base 和 ethtool 的软件包定义。
- 运行 make package/feeds/luci/luci-app-sfp-status/compile 生成 ipk。
- 将生成的 ipk 作为 GitHub Actions artifact 上传。
- 在版本 tag 构建成功后，自动把 ipk 发布到 GitHub Releases。

使用方式：

1. 将仓库推送到 GitHub。
2. 打开仓库的 Actions 页面。
3. 选择 Build luci-app-sfp-status 工作流。
4. 点击 Run workflow 手动执行，默认会使用 mediatek/filogic 这个 ARMv8 目标；如有需要，也可以在运行前改成其他 target/subtarget。
5. 在本次运行的 Artifacts 中下载生成的 ipk 文件。

自动发布 Release 的方式：

- 在本地创建版本 tag，例如：

```sh
git tag v0.1.0
git push origin v0.1.0
```

- GitHub Actions 会先编译插件。
- 编译成功后，工作流会自动创建或更新同名 GitHub Release。
- 生成的 ipk 会自动上传到该 Release 附件中。

手动发布 Release 的方式：

1. 打开 Actions 页面并运行 Build luci-app-sfp-status。
2. 将 publish_release 设为 true。
3. 填写 release_tag，例如 v0.1.0。
4. 工作流会在编译成功后自动发布到对应的 GitHub Release。

说明：

- 该包在 Makefile 中声明为 all 架构，因此即使工作流默认使用 ARMv8 的 mediatek/filogic SDK 进行打包，生成的安装包仍然是 all.ipk。
- 现在默认目标已经改为 ARMv8 场景；如果你的设备是其他 ARMv8 平台，可以在手动运行工作流时把 target/subtarget 改成对应值。
- 如果后续需要严格跟随某个 OpenWrt 24.10 小版本，也可以在手动运行工作流时修改 openwrt_version，或直接调整工作流默认值。
- Release 流程默认只会在版本 tag 或手动勾选 publish_release 时触发，普通提交仍然只编译并上传 artifact，不会污染 Releases 页面。

## 运行验证

安装生成的 ipk 后，执行：

```sh
opkg install luci-app-sfp-status_0.1.0-r17_all.ipk
ubus -v list luci.sfp-status
ubus call luci.sfp-status getStatuses '{}'
```

随后打开 LuCI：

- 升级后，状态 菜单中不再显示独立的 SFP 页面入口。
- 如果浏览器之前打开过旧版页面，先做一次强制刷新，避免继续使用缓存的旧 JS。
- 进入 状态 > 概览，确认每个检测到的 SFP 模块都会单独展示，并且在 luci-theme-argon 下样式显示正常。
