# 天津五大道—小白楼路网

`tianjin.json` 保存课堂演示使用的离线路网。提取日期记录在 `extracted_on`，原始请求记录在 `source_url`。运行项目时直接使用这份快照。

2026-11-17 提取的交付快照包含 498 条道路记录、2,273 个路网节点和 8 个地标。按单行方向展开后共有 3,212 条有向路段。

- 提取矩形西界 117.193°E、南界 39.102°N、东界 117.220°E、北界 39.126°N。绘图范围 `bounds` 在每侧多留 0.001°，用于保留接口返回的部分道路端点。只保留绘图范围内连续且至少含两个节点的道路片段，越界后再次进入的片段沿用原道路 ID，独立保存。 [OpenStreetMap 原始导出](https://api.openstreetmap.org/api/0.6/map?bbox=117.193,39.102,117.220,39.126)
- 道路筛选保留 `motorway`、`trunk`、`primary`、`secondary`、`tertiary` 及其连接道，以及 `residential`、`unclassified`、`living_street`。按机动车访问标签和明确或隐含的单行方向建图。按道路共用的 OSM 节点连接，相同坐标的不同 OSM 节点分别保留。转向限制、时间段规则和临时交通管制属于教学模型的范围边界。
- 地标对应原始 OSM 点或区域。系统在同一片可相互到达的路网中为地标匹配附近的机动车道路节点。查询起终点是这些匹配节点。
- 道路名称优先使用中文标签，缺省时保留通用名称。快照保留源数据中的路面材质标签，路径模块为缺少标签的道路使用教学默认值。

## 重新提取

如需用同一套筛选规则刷新数据，在项目根目录联网运行以下命令。OpenStreetMap 数据会随编辑而更新，重新提取的结果可能与随项目交付的快照有差别。

```powershell
python -B tools/build_road_data.py
```

## 数据署名

路网数据 © OpenStreetMap contributors。本目录的路网快照按 Open Database License（ODbL）1.0 提供。 [OpenStreetMap 许可与署名](https://www.openstreetmap.org/copyright) [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
