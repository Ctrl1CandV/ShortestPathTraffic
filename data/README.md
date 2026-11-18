# 离线城区路网

天津、北京随程序加载。想演示其他城市时，在页面点击「导入城市包」，依次选择 `examples/` 中想用的 JSON 文件。下表给出每个样区的一键演示。每份快照的 `extracted_on` 记录提取日期，`source_url` 指向提取时使用的 OpenStreetMap 请求。

| 样区与文件 | 使用方式 | 提取日期 | 道路记录 | 节点 | 有向线段 | 地标 | 演示起终点 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 天津五大道—小白楼 [tianjin.json](tianjin.json) | 内置 | 2026-11-17 | 498 | 2,273 | 3,212 | 8 | 五大道公园 → 天津音乐厅 |
| 北京东城 [beijing.json](beijing.json) | 内置 | 2026-11-18 | 174 | 567 | 807 | 7 | 簋街雕像 → 孚王府 |
| 济南大明湖南侧—泉城广场 [jinan.json](../examples/jinan.json) | 导入 | 2026-11-18 | 215 | 785 | 1,316 | 7 | 人民会堂 → 百花洲北入口 |
| 太原迎泽 [taiyuan.json](../examples/taiyuan.json) | 导入 | 2026-11-18 | 99 | 426 | 625 | 6 | 唱经楼 → 山西饭店 |
| 石家庄市中心 [shijiazhuang.json](../examples/shijiazhuang.json) | 导入 | 2026-11-18 | 54 | 384 | 611 | 7 | 平安公园 → 石家庄国际博览中心 |
| 西安城墙内 [xian.json](../examples/xian.json) | 导入 | 2026-11-18 | 207 | 1,000 | 1,423 | 7 | 西安钟楼 → 和平门 |

道路记录保留原始道路的连续线形。寻路时，相邻节点之间沿允许的方向各生成一条有向线段。一条道路记录可能生成多条线段。

## 范围、道路和地标

以下是各样区的提取矩形，坐标依次为西界经度、南界纬度、东界经度、北界纬度，单位为度。

- 天津 `117.193, 39.102, 117.220, 39.126`。 [OpenStreetMap 天津导出](https://api.openstreetmap.org/api/0.6/map?bbox=117.193,39.102,117.220,39.126)
- 北京 `116.412, 39.923, 116.430, 39.941`。 [OpenStreetMap 北京导出](https://api.openstreetmap.org/api/0.6/map?bbox=116.412,39.923,116.430,39.941)
- 济南 `117.010, 36.660, 117.029, 36.674`。 [OpenStreetMap 济南导出](https://api.openstreetmap.org/api/0.6/map?bbox=117.010,36.660,117.029,36.674)
- 太原 `112.557, 37.862, 112.570, 37.874`。 [OpenStreetMap 太原导出](https://api.openstreetmap.org/api/0.6/map?bbox=112.557,37.862,112.570,37.874)
- 石家庄 `114.495, 38.035, 114.520, 38.050`。 [OpenStreetMap 石家庄导出](https://api.openstreetmap.org/api/0.6/map?bbox=114.495,38.035,114.520,38.050)
- 西安 `108.939, 34.248, 108.959, 34.265`。 [OpenStreetMap 西安导出](https://api.openstreetmap.org/api/0.6/map?bbox=108.939,34.248,108.959,34.265)

- 绘图范围 `bounds` 在提取矩形每侧多留 0.001°，用于保留接口返回的部分道路端点。只保留绘图范围内连续且至少含两个节点的道路片段，越界后再次进入的片段沿用原道路 ID，独立保存。
- 道路筛选保留 `motorway`、`trunk`、`primary`、`secondary`、`tertiary` 及其连接道，以及 `residential`、`unclassified`、`living_street`。按机动车访问标签和明确或隐含的单行方向建图。按道路共用的 OSM 节点连接，相同坐标的不同 OSM 节点分别保留。转向限制、时间段规则和临时交通管制属于教学模型的范围边界。
- 地标对应原始 OSM 点或区域。系统在同一片可相互到达的路网中为地标匹配附近的机动车道路节点。查询起终点是这些匹配节点。
- 道路名称优先使用中文标签，缺省时保留通用名称。快照保留源数据中的路面材质标签，路径模块为缺少标签的道路使用教学默认值。

## 重新提取

在项目根目录联网运行相应命令即可刷新指定快照。无参数时默认刷新天津数据。OpenStreetMap 数据会随编辑而更新，重新提取的结果可能与随项目交付的快照有差别。

```powershell
python -B tools/build_road_data.py
python -B tools/build_road_data.py --city beijing
python -B tools/build_road_data.py --city jinan
python -B tools/build_road_data.py --city taiyuan
python -B tools/build_road_data.py --city shijiazhuang
python -B tools/build_road_data.py --city xian
```

## 数据署名

路网数据 © OpenStreetMap contributors。上述样区快照均按 Open Database License（ODbL）1.0 提供。每份 JSON 都包含署名与许可证地址。 [OpenStreetMap 许可与署名](https://www.openstreetmap.org/copyright) [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
