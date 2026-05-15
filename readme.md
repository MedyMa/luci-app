# LuCI Apps 汇总

本文档汇总当前工作区内 4 个 LuCI app 的包信息、页面入口、配置文件、权限范围、后端接口和运行验证方式。当前目标分支按 OpenWrt / LuCI 24.10 兼容要求整理，并已吸收 luci-app-sfp-status 上游 README 中的主题兼容、自动化构建和运行验证要点。

## 快速导航

1. [App 总览](#app-总览)
2. [通用目录布局](#通用目录布局)
3. [luci-app-adguardhome](#luci-app-adguardhome)
4. [luci-app-fan](#luci-app-fan)
5. [luci-app-modemband](#luci-app-modemband)
6. [luci-app-sfp-status](#luci-app-sfp-status)
7. [构建与验证](#构建与验证)
8. [维护注意事项](#维护注意事项)

## App 总览

| App | 包版本 | 主要用途 | LuCI 入口 | 主要依赖 |
| --- | --- | --- | --- | --- |
| luci-app-adguardhome | 1.8-r21 | AdGuard Home 服务控制、核心管理、YAML 编辑、日志查看和 GFW DNS 规则工具 | 服务 > AdGuard Home | luci-base、rpcd、wget 或 curl |
| luci-app-fan | 0.1.0-r25 | BPI-R4 等设备的 pwm-fan 风扇控制、温度/PWM/RPM 实时面板 | 状态 > 风扇控制 | luci-base、coreutils-stat |
| luci-app-modemband | 2.0-r8 | 4G/5G 模组频段配置、模组状态、信号、小区、SIM 信息展示 | 移动蜂窝 > 模组配置 | modemband |
| luci-app-sfp-status | 0.1.0-r19 | SFP/SFP+ DOM 遥测读取，并嵌入状态概览页展示 | 状态 > 概览 include | luci-base、ethtool |

## 通用目录布局

各 app 基本沿用 OpenWrt/LuCI 包结构：

| 路径 | 作用 |
| --- | --- |
| Makefile | OpenWrt 包元数据、依赖、安装后脚本、conffiles 声明 |
| htdocs/luci-static/resources/view/ | LuCI JavaScript view 或状态页 include |
| root/etc/config/ | 默认 UCI 配置 |
| root/etc/init.d/ | init 服务脚本，仅服务型 app 使用 |
| root/etc/uci-defaults/ | 安装后初始化和迁移逻辑 |
| root/usr/libexec/rpcd/ | rpcd 后端脚本，提供 ubus 方法 |
| root/usr/share/rpcd/acl.d/ | LuCI ACL 权限定义 |
| root/usr/share/luci/menu.d/ | LuCI 菜单入口定义 |
| po/zh_Hans/ | 简体中文翻译 |

## luci-app-adguardhome

### AdGuardHome 包信息

- 包名：luci-app-adguardhome
- 版本：1.8-r21
- 架构：all
- 维护来源：AdGuardHome 上游链接保留在 Makefile 中
- 配置保留文件：/usr/share/AdGuardHome/links.txt、/etc/config/AdGuardHome、/etc/config/adGuardConfig/AdGuardHome.yaml

### AdGuardHome 功能范围

- 服务概览：展示启用状态、运行状态、核心文件、配置文件、工作目录、版本、DNS 端口、重定向状态等。
- 设置中心：管理运行参数、下载架构、发布通道、备份项和 GFW 规则操作。
- YAML 编辑器：读取模板、当前配置、保存临时 YAML、丢弃临时修改。
- 运行日志：读取服务日志、更新日志和系统日志快照，支持清空日志。
- 核心更新：通过 update_core.sh 拉取或更新 AdGuard Home 核心文件。
- GFW 工具：通过 gfw2adg.sh、gfwipset2adg.sh、links.txt 维护上游 DNS 和 ipset 规则。

### AdGuardHome 前端文件

| 文件 | 作用 |
| --- | --- |
| htdocs/luci-static/resources/view/adguardhome/overview.js | 概览页 |
| htdocs/luci-static/resources/view/adguardhome/settings.js | 设置与 GFW 工具页 |
| htdocs/luci-static/resources/view/adguardhome/yaml.js | YAML 编辑器 |
| htdocs/luci-static/resources/view/adguardhome/log.js | 日志页 |

### AdGuardHome 后端与权限

- rpcd 后端：root/usr/libexec/rpcd/luci.adguardhome
- ubus 对象：luci.adguardhome
- 只读方法：getStatus、getMeta、getYaml、getCurrentYaml、getTemplateConfig、getLog
- 写方法：saveYaml、discardYaml、clearLog、startUpdate、gfwAction、setLinks
- ACL：root/usr/share/rpcd/acl.d/luci-app-adguardhome.json
- init 服务：root/etc/init.d/AdGuardHome

### AdGuardHome UCI 配置要点

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| enabled | 0 | 是否启用服务 |
| httpport | 3000 | Web 管理端口 |
| redirect | none | DNS 重定向模式 |
| configpath | /etc/config/adGuardConfig/AdGuardHome.yaml | YAML 配置路径 |
| workdir | /etc/config/adGuardConfig/workspace | 工作目录 |
| logfile | /tmp/AdGuardHome.log | 日志路径 |
| binpath | /etc/config/adGuardConfig/AdGuardHome | 核心文件路径 |
| downloadarch | auto | 核心下载架构 |
| release_channel | release | 核心发布通道 |
| gfw / gfwipset | 0 / 0 | GFW DNS / ipset 规则状态 |

### AdGuardHome 效果图

<img width="1673" height="699" alt="image" src="https://github.com/user-attachments/assets/516627ac-07a9-48d8-badb-f69bd0c85ef6" />


## luci-app-fan

### Fan 包信息

- 包名：luci-app-fan
- 版本：0.1.0-r25
- 架构：all
- 许可证：Apache-2.0
- 维护者：MedyMa
- 配置保留文件：/etc/config/luci-fan

### Fan 功能范围

- 实时状态面板：读取 CPU 温度、PWM 占空比、风扇 RPM、当前模式和服务状态。
- 控制模式：turbo、smart、manual。
- 智能模式：根据 off_temp / on_temp 自动计算 PWM 输出。
- 手动模式：按 manual_pwm 设置固定 PWM 目标。
- 最大转速估算：用 max_rpm 约束或估算 RPM 显示。
- 表单快捷操作：将狂暴、智能、手动配置快速写入表单，再通过 LuCI 保存应用。

### Fan 前端文件

| 文件 | 作用 |
| --- | --- |
| htdocs/luci-static/resources/view/fan.js | 风扇控制页面，包含实时面板和 UCI 表单 |

### Fan 后端与权限

- rpcd 后端：root/usr/libexec/rpcd/luci.fan
- ubus 对象：luci.fan
- 只读方法：getStatus
- UCI 权限：读取和写入 luci-fan
- 辅助控制脚本：root/usr/libexec/fan-control
- init 服务：root/etc/init.d/luci-fan
- ACL：root/usr/share/rpcd/acl.d/luci-app-fan.json

### Fan UCI 配置要点

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| enabled | 0 | 是否启用风扇服务 |
| mode | smart | 控制模式 |
| manual_pwm | 70 | 手动 PWM 百分比 |
| on_temp | 60 | 智能模式升速温度 |
| off_temp | 30 | 智能模式停转或低速温度 |
| max_rpm | 3000 | 最大风扇转速估算值 |
| poll_interval | 5 | 状态轮询间隔 |

### Fan 效果图

<img width="1613" height="1358" alt="image" src="https://github.com/user-attachments/assets/2610f636-0159-4e5e-975e-50611eeefee7" />


## luci-app-modemband

### Modemband 包信息

- 包名：luci-app-modemband
- 版本：2.0-r8
- 许可证：MIT
- 来源：Rafał Wabik / IceG modemband LuCI JS 支持
- 主要依赖：modemband

### Modemband 功能范围

- 概览页：展示模组厂商、型号、版本、IMEI、设备状态、主 AT 端口、运营商、接入技术、当前小区、信号、温度、电压、地区和 SIM 卡信息。
- SIM 卡信息：优先通过 ModemManager SIM 对象读取 ICCID、IMSI、EID、运营商和 SIM 类型；同时通过 AT+CPIN?、AT+QCCID / AT+CCID、AT+CIMI 兜底。
- 频段设置：读取和设置 LTE、5G SA、5G NSA 首选频段。
- 配置页：选择通信端口、WAN 重启行为、模组重启行为、通知开关和模板文件。
- 模组识别：loaded.sh 会从 UCI 或 USB Vendor/ProdID 识别当前模组模板。

### Modemband 前端文件

| 文件 | 作用 |
| --- | --- |
| htdocs/luci-static/resources/view/modem/overview.js | 模组实时概览、信号/小区/SIM 信息 |
| htdocs/luci-static/resources/view/modem/blte.js | LTE/5G 频段设置 |
| htdocs/luci-static/resources/view/modem/blteconfig.js | 应用配置与模板编辑 |

### Modemband 后端与权限

- 无独立 rpcd 后端脚本，主要通过 LuCI fs.exec_direct 调用命令行工具。
- 可执行工具：/usr/bin/modemband.sh、/usr/bin/loaded.sh、/usr/bin/mmcli、/usr/bin/sms_tool
- 文件权限：读取 /dev、/etc/modemband、/usr/share/modemband，写入 /etc/modemband 和 /usr/share/modemband/*
- UCI 权限：modemband、luci-app-modemband
- ACL：root/usr/share/rpcd/acl.d/luci-app-modemband.json

### Modemband UCI 配置要点

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| iface | wan | 变更频段后关联的 WAN 接口 |
| wanrestart | 0 | 频段变更后是否重启 WAN |
| modemrestart | 0 | 频段变更后是否重启模组 |
| notify | 0 | 是否关闭或调整变更提示 |

### Modemband 数据来源

| 数据 | 来源 |
| --- | --- |
| 模组列表和状态 | mmcli -L -J、mmcli -m &lt;index&gt; -J |
| 位置/小区信息 | mmcli --location-get、AT+QENG="servingcell" |
| 信号质量 | ModemManager signal-quality、AT+CSQ、QENG RSRP/RSRQ/SINR |
| 接入技术和频段 | AT+QNWINFO、AT+QENG="servingcell" |
| 温度 | AT+QTEMP、AT+QTEMP?、AT+CPMUTEMP |
| 电压 | AT+CBC |
| SIM 状态和号码 | ModemManager SIM 对象、AT+CPIN?、AT+QCCID / AT+CCID、AT+CIMI |

### Modemband 效果图

<img width="1628" height="1290" alt="image" src="https://github.com/user-attachments/assets/3a62a73f-6348-46a5-a46d-bceaa91525ba" />


## luci-app-sfp-status

### SFP Status 包信息

- 包名：luci-app-sfp-status
- 版本：0.1.0-r19
- 架构：all
- 许可证：Apache-2.0
- 维护者：GitHub Copilot
- 配置保留文件：/etc/config/sfp-status
- 页面形态：状态 > 概览 include，升级后不再保留独立 SFP 菜单入口

### SFP Status 功能范围

- 在状态 > 概览中嵌入 SFP 状态组件，不提供独立菜单入口。
- 自动探测可读取 DOM 的 SFP/SFP+ 接口。
- 支持单接口查询和多模块汇总查询。
- 多模块在概览页中按连续表格展示，表头为 Module、SFP1、SFP2 等模块槽位。
- 展示模块型号、温度、速率、电压、偏置电流、RX Power、TX Power 等信息。
- 通过显式超时保护 UCI/RPC 读取，避免状态概览页被 pending promise 卡住。

### SFP Status 主题兼容

- 组件使用标准 LuCI 结构类，如 cbi-section、table、tr、td 和 ifacebadge。
- 在不依赖页面专用 CSS 覆盖的前提下，能够跟随 LuCI 原生布局模型。
- 当前实现针对 luci-theme-argon 做过实际兼容处理，支持日间白蓝和夜间蓝黑风格。

### SFP Status 关键文件说明

| 文件 | 说明 |
| --- | --- |
| htdocs/luci-static/resources/view/status/include/15_sfp.js | 状态 > 概览 include 组件，负责单模块或多模块表格渲染 |
| root/usr/libexec/rpcd/luci.sfp-status | rpcd 后端，提供 getInterfaces、getStatus、getStatuses |
| root/usr/share/rpcd/acl.d/luci-app-sfp-status.json | LuCI ACL 只读权限定义 |
| root/etc/config/sfp-status | SFP 概览显示相关默认 UCI 配置 |
| .github/workflows/main.yml | SFP 包的 GitHub Actions 自动构建与发布工作流 |

### SFP Status 前端文件

| 文件 | 作用 |
| --- | --- |
| htdocs/luci-static/resources/view/status/include/15_sfp.js | 状态 > 概览 include 组件 |

### SFP Status 后端与权限

- rpcd 后端：root/usr/libexec/rpcd/luci.sfp-status
- ubus 对象：luci.sfp-status
- 只读方法：getInterfaces、getStatus、getStatuses
- 数据来源：/usr/sbin/ethtool、/sys/class/net
- ACL：root/usr/share/rpcd/acl.d/luci-app-sfp-status.json

### SFP Status UCI 配置要点

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| overview_enabled | 1 | 是否在状态概览中显示 SFP include |

### SFP Status 数据来源

未配置接口时，后端会自动探测所有可读取 SFP DOM 数据的网络设备，并在概览页逐个展示。

| 命令 | 说明 |
| --- | --- |
| ethtool -m &lt;ifname&gt; | 读取 SFP DOM 遥测和模块信息 |
| ethtool &lt;ifname&gt; | 读取链路状态、速率、端口、双工信息 |
| /sys/class/net/&lt;ifname&gt;/speed | ethtool 未给出速率时的备用速率来源 |

### SFP Status 自动化构建与发布

- 仓库已包含 [main.yml](.github/workflows/main.yml) 工作流，用于自动构建 luci-app-sfp-status。
- 默认目标是 OpenWrt 24.10.0 的 mediatek/filogic SDK，工作流也支持通过 `sdk_distribution` 切换到 ImmortalWrt。
- 构建流程会下载 SDK、更新 feeds、将 `luci-app-sfp-status` 注入 LuCI feed、安装包定义并编译 IPK。
- 编译产物会作为 GitHub Actions artifact 上传。
- 当推送 `v*` tag，或手动运行 workflow 并设置 `publish_release=true` 时，工作流会自动创建或更新 GitHub Release，并上传生成的 IPK。
- 包在 Makefile 中声明为 `all` 架构，因此即使 SDK 目标默认为 ARMv8，生成的安装包仍然是 `all.ipk`。

### SFP Status 运行验证

安装构建产物后，可按如下顺序验证：

```sh
opkg install luci-app-sfp-status_0.1.0-r19_all.ipk
ubus -v list luci.sfp-status
ubus call luci.sfp-status getStatuses '{}'
```

页面验证要点：

1. 升级后，状态菜单中不应再出现独立的 SFP 页面入口。
2. 如果浏览器之前打开过旧版页面，先强制刷新，避免继续使用缓存的旧 JS。
3. 进入状态 > 概览，确认检测到的 SFP 模块会在概览页内渲染，并且在 Argon 主题下样式正常。

### SFP Status 效果图

![SFP Status 界面效果图](https://github.com/user-attachments/assets/95d8c61b-aa50-432c-8650-cc5b61021d6d)

## 构建与验证

### OpenWrt SDK 构建

将对应 app 放入 LuCI feed 或 feeds/luci/applications/ 后，可按包名单独编译：

```sh
make package/feeds/luci/luci-app-adguardhome/compile V=s
make package/feeds/luci/luci-app-fan/compile V=s
make package/feeds/luci/luci-app-modemband/compile V=s
make package/feeds/luci/luci-app-sfp-status/compile V=s
```

### 安装后通用检查

```sh
rm -rf /tmp/luci-modulecache /var/luci-modulecache
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* /var/luci-indexcache.*
/etc/init.d/rpcd reload
```

### 运行时接口检查

```sh
ubus -v list luci.adguardhome
ubus call luci.adguardhome getStatus '{}'

ubus -v list luci.fan
ubus call luci.fan getStatus '{}'

ubus -v list luci.sfp-status
ubus call luci.sfp-status getStatuses '{}'
```

modemband 没有独立 ubus 对象，运行时重点检查命令和页面权限：

```sh
mmcli -L -J
mmcli -m 0 -J
sms_tool -d /dev/ttyUSB2 at AT+CSQ
sms_tool -d /dev/ttyUSB2 at AT+CPIN?
```

### LuCI 页面检查

| App | 页面 |
| --- | --- |
| luci-app-adguardhome | 服务 > AdGuard Home > 概览 / 设置 / YAML 编辑器 / 运行日志 |
| luci-app-fan | 状态 > 风扇控制 |
| luci-app-modemband | 移动蜂窝 > 模组配置 > 概览 / 频段设置 / 配置 |
| luci-app-sfp-status | 状态 > 概览中的 SFP 区块 |

## 维护注意事项

- 新增 LuCI JS view 时，同步检查 menu.d、acl.d、po/zh_Hans 和 Makefile 安装面。
- 新增 ubus 方法时，同步收紧 ACL，只开放实际使用的方法。
- 状态概览 include 中的 UCI、RPC 或硬件探测调用应使用显式超时，避免拖死整个状态页。
- 修改前端资源后，运行至少一次 node --check，并清理 LuCI module/index cache。
- 主题适配优先复用 LuCI 原生 cbi-section、table、tr、td、ifacebadge 等结构；需要自定义样式时，保持 Argon 日间白蓝、夜间蓝黑基调。
