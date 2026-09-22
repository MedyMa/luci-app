# UCG Fiber 原生流量统计：ImmortalWrt 下游路由方案

当前链路：中国联通 PPPoE → UCG Fiber → ImmortalWrt → miwifi（AP）→ 终端。ImmortalWrt 当前对 IPv4 上联做 NAT，因此 UCG 在源地址层主要看到 ImmortalWrt。Traffic 的 API 无法把应用归属统计写入 UniFi Network 原生图表；此方案让 UCG 自己观察保留源 IP 的下游流量。UCG 是否把路由后的终端显示为完整的原生客户端对象，需要实机验证。

## 已核实地址与待核对配置

用户提供的 ImmortalWrt 接口截图显示：LAN 为 `192.168.2.1/24`，WAN 为 `192.168.1.6/24`。因此 UCG 静态路由的目标是 `192.168.2.0/24`，下一跳是 `192.168.1.6`。操作前仍须核对 UCG 的对应 LAN、实际防火墙区域、出口 NAT 和管理回退方式。

| 项目 | 当前线索 | 操作前确认 |
|---|---|---|
| UCG LAN／到 ImmortalWrt 的连接网段 | ImmortalWrt WAN 为 `192.168.1.6/24` | UCG 网络配置、对应接口 |
| ImmortalWrt 上联地址 | 截图确认 `192.168.1.6/24` | 对应防火墙区域及管理路径 |
| ImmortalWrt 下游网关 | 截图确认 `192.168.2.1/24` | 无 |
| 下游目的网段 | `192.168.2.0/24` | UCG 路由页面填写值 |
| UCG PPPoE、出口 NAT | 现有拨号状态 | UCG Internet、Global NAT 设置 |
| miwifi | AP 模式 | 无路由/NAT，终端默认网关是 ImmortalWrt |

## 分阶段操作

1. 分别导出 UCG Network 和 ImmortalWrt 配置，记录现有 NAT、静态路由、WAN/LAN、IPv6 前缀与防火墙状态。保留一个直连 ImmortalWrt LAN 的管理端；预先准备 LuCI 的自动回滚窗口。
2. 在 UCG Network 创建静态路由：**Destination = `192.168.2.0/24`，Next Hop = `192.168.1.6`**。先确认 UCG 的对应网络接口可直达下一跳；不要把路由目标写成 `192.168.2.1/32`。
3. 验证 UCG 与 ImmortalWrt 上联互通、下游设备仍可通过 ImmortalWrt 出网。此时先不改变 NAT；静态路由应可安全单独检查。
4. 在 ImmortalWrt 的**UCG-facing WAN 防火墙区域**关闭 IPv4 Masquerading。保留 LAN→WAN 转发和现有出站规则；不要改 PPPoE、UCG 的出口 NAT 或 miwifi AP 模式。按设备真实防火墙区和策略操作，不套用未经核实的 UCI section 序号。
5. 从下游设备验证公网访问、DNS、IPv4 回程和 UCG `Insights > Flows` 中的源 IP。对照 UCG 端口／WAN 总量与 Traffic 总量；绝不能把两套不同窗口的数字硬凑成相等。再检查 UniFi Network 的 Traffic Identification 与客户端页面是否按设备显示；即使 Flow 有源 IP，客户端目录仍可能不自动收录路由后的设备。
6. 单独检查 IPv6：IPv6 通常不走 IPv4 Masquerading，本变更不应误改前缀委派、RA、IPv6 默认路由或防火墙。

## 回退与失败判据

若下游设备出网、DNS 或回程中断，先在 ImmortalWrt 恢复原 WAN 区域的 Masquerading 并应用；确认上网恢复后再删除新增的 UCG 静态路由。若已失去上联管理能力，从保留的 LAN 管理端或配置备份恢复。实机试验前应记录原值；仅凭本文件无法安全生成可直接执行的更改命令。

## 依据

- [UniFi 网关流量与设备识别](https://help.ui.com/hc/en-us/articles/12570783535383-UniFi-Gateway-Traffic-and-Device-Identification)
- [UniFi DNAT、SNAT 与 Masquerading](https://help.ui.com/hc/en-us/articles/16437942532759-DNAT-SNAT-and-Masquerading-in-UniFi)
- [UniFi Traffic Flows](https://help.ui.com/hc/en-us/articles/32201256219799-Traffic-Flows-and-Traffic-Logging-in-UniFi-Network)
- [UniFi 官方 API](https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API)
