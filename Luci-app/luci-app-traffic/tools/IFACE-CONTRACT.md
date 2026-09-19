# 0.1.90 修复契约：WAN 接口计数器成为权威总量

## 根因（已实测，不是推测）

流量统计不准的根因是**流卸载（flow offloading）绕过记账层**：

| 配置 | conntrack 字节增量 | eth2 RX 增量 | 覆盖率 |
|---|---|---|---|
| `flow_offloading=1` + `flow_offloading_hw=1` | 208 MiB | 3063 MiB | 6.8% |
| `flow_offloading=1` + `flow_offloading_hw=0` | 147 MiB | 2579 MiB | 5.7% |

结论：
- **两种卸载各自都足以让 conntrack 失明**，关掉硬件卸载没用。
- nft 计数链挂在 netfilter hook 上，同样被绕过（实测 2.05 MiB vs 535 MiB）。
- 现有代码在检测到卸载时 `CFG_ACCT=0` 回退到 conntrack —— **回退到的也是一个失明的层**。
- `write_summary()` 的 `totals` 是 `totals.tsv` 里各应用归属字节的**求和**，所以「总计」本身就是归属值，直接继承了 6% 的失明。
- `classify()` 里 `sd += d; su += u`（行 1083）写进 `sample.tsv`，`record_sample()` 再据此画曲线 → **曲线/峰值/速率全部失明**。

因此总量必须来自 `/proc/net/dev` 的接口计数器：它在驱动层，位于 fast path 之下，**开不开卸载都准确**。

## 原则

1. **总量/曲线/峰值/速率** ← 接口计数器（权威）。
2. **应用/客户端归属** 仍用 nft/conntrack，但**只作为占比**呈现（`已归属 X%`），不再冒充总量。
3. 归属偏低**不是错误**，但必须**显式可见**，不能静默。

## 数据面契约（冻结，不要改动字段名）

### `live.env`（collector.sh 写，live.sh 读）

新增一行：

```
WAN_IF=eth2
```

- 为空表示没识别出 WAN 设备 → live.sh **必须**回退到现有 conntrack 路径，行为与今天完全一致。
- 其余键（`LAN4` `LAN6` `SELF` `SOURCE` `TABLE`）保持不变。

### `summary.json`（collector.sh 写，rpcd 原样透传，页面读）

新增字段：

```json
"iface":{"dev":"eth2","down":3221234567,"up":789123456},
"offload":0,
```

- `iface`：本会话累计（字节），来自 `/proc/net/dev` 该设备的 rx_bytes / tx_bytes 累加。
  - **识别不出 WAN 设备时整个 `iface` 键不写**，页面必须回退到 `totals`。
  - 首次读只做基线、不累加（否则会把开机以来的全部流量算进会话）。
  - 计数回退（设备重建 / 重启）时按「重置为本次读数」处理，不产生负值、不丢整轮。
- `offload`：0/1，是否检测到 `firewall.@defaults[0].flow_offloading` 或 `flow_offloading_hw` 为 1。
- 既有 `totals`（归属值求和）、`accounted`、`acct`、`acct_offload`、`acct_error` **语义不变**（向后兼容）。
- `apps[]` 元素新增可选 `"proto":1`：该「应用名」其实是协议桶（`SSL/TLS` `QUIC` `HTTP` `DNS` `STUN` `RTSP` `Email` `ICMP` `Other`），不是应用。

### 状态文件（`$STATE_DIR` = `/tmp/traffic`）

- `wan.abs`：两行，上一轮的绝对计数 `<rx_bytes>\n<tx_bytes>`。
- `wan.tsv`：两行，本会话累计 `<down>\n<up>`。
- `wan.delta`：两行，本轮的增量 `<down>\n<up>`（供 `record_sample` 使用）。

以上均为 `/tmp` 易失状态，跟 `totals.tsv` 同类；`STATE_VERSION` 需要 +1，让升级后旧含义的计数器被重建（`init_state()` 已有该机制）。

## 写作用域（一个文件只有一个写者）

| 文件 | 责任人 |
|---|---|
| `root/usr/share/traffic/collector.sh` | Lead |
| `root/usr/share/traffic/live.sh` | live 组员 |
| `htdocs/.../view/traffic/overview.js`、`root/usr/share/luci/menu.d/../po` 文案 | 页面组员 |
| `tools/*-selftest.*` | 各自负责对应模块的断言；Lead 最终跑全量 |

**禁止跨域改动**：页面组员不要动 collector.sh；collector 不要动 overview.js。

## 各层验收标准

### collector.sh（Lead）
- `wan_if()` 能在没有 `ip` 命令的情况下从 `/proc/net/route` 取默认路由设备；IPv6 默认路由（`/proc/net/ipv6_route`）作为第二选择。
- `record_sample()` 在有 `wan.delta` 时用接口增量作为曲线点；没有时回退 `sample.tsv`（离线测试不受影响）。
- 首次读不累加、计数回退不产生负数。
- `summary.json` 里 `iface` 与 `offload` 正确；`iface` 缺失时页面回退可用。
- `tools/collector-selftest.sh` 全绿，并新增断言：设备不存在时 `wan.tsv` 不变、计数回退被正确处理、`iface` 字段出现在 summary 里。

### live.sh（live 组员）
- `WAN_IF` 非空且 `/proc/net/dev` 可读时，`live.json` 的 `bps_down`/`bps_up` 由该设备 rx/tx 增量 / `dt` 得出，`source` 为 `"iface"`。
- **单位与字段含义必须与今天完全一致**（`peak_read`/`record_peak`/`peak-selftest` 依赖它），只换来源，不改语义。
- `WAN_IF` 为空或设备读不到 → 逐字节回退到现有 conntrack 路径。
- 保留既有的空 `live.flows.new` 守卫（那是防止把基线清零的回归）。
- 顺手修掉 `live.watch` 的失败重定向日志刷屏。
- `tools/live-selftest.sh` 与 `tools/peak-selftest.sh` 全绿 + 新增接口来源断言。

### overview.js（页面组员）
- 「总计/下载/上传」优先取 `iface`，缺失时回退 `totals`。
- 速率用 `iface` 两次快照之差 / `dt`，缺失时回退 `totals`。
- 诊断行新增「已归属 X%」= (`totals.down`+`totals.up`) / (`iface.down`+`iface.up`)；`offload=1` 且占比低时给出**明确告警文案**，说明这是卸载导致、应用明细只是部分。
- `apps[]` 里 `proto:1` 的行**不得**再以「应用」身份出现在应用表里（归到协议/未识别一组）。
- **热门客户端**列要说明它是**本次运行**的统计（会话级聚合），与范围视图的应用总量不同窗口 —— 这是此前出现 114.7%/2458% 荒谬百分比的原因。
- 新文案进 `traffic.po`；`_()` 包裹；不得删掉既有翻译条目。
- 本地渲染验证：`tools/page-render-selftest.js`（headless Chrome，绝不外传）。

## 最终验证（Lead）
本地跑：`collector-selftest.sh`、`live-selftest.sh`、`rpcd-selftest.sh`、`peak-selftest.sh`、`page-render-selftest.js`、`check-icons.js`，然后升版本号 → 推送 → 触发 CI。
