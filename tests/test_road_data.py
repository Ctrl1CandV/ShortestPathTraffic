from datetime import date
from xml.etree.ElementTree import fromstring

from tools.build_road_data import build_snapshot


EXTRACTED_ON = date(2026, 11, 17)


def test_extract_applies_motorcar_access_and_preserves_osm_node_identity():
    osm = fromstring("""
        <osm>
          <node id="1" lon="117.200" lat="39.110"/>
          <node id="2" lon="117.202" lat="39.112"/>
          <node id="3" lon="117.202" lat="39.112"/>
          <node id="4" lon="117.204" lat="39.113"/>
          <way id="10"><nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="primary"/><tag k="oneway" v="-1"/></way>
          <way id="11"><nd ref="2"/><nd ref="4"/>
            <tag k="highway" v="residential"/><tag k="access" v="no"/>
            <tag k="motor_vehicle" v="yes"/><tag k="junction" v="roundabout"/>
            <tag k="oneway" v="no"/></way>
          <way id="12"><nd ref="1"/><nd ref="2"/>
            <tag k="highway" v="primary"/><tag k="access" v="no"/></way>
          <way id="13"><nd ref="2"/><nd ref="3"/><tag k="highway" v="footway"/></way>
          <way id="14"><nd ref="3"/><nd ref="4"/>
            <tag k="highway" v="tertiary"/><tag k="junction" v="roundabout"/></way>
          <way id="15"><nd ref="1"/><nd ref="4"/>
            <tag k="highway" v="secondary"/><tag k="motor_vehicle:forward" v="no"/></way>
        </osm>
    """)

    snapshot = build_snapshot(osm, EXTRACTED_ON, landmarks=())

    assert {road["id"]: (road["nodes"], road["oneway"]) for road in snapshot["roads"]} == {
        10: ([1, 2], -1),
        11: ([2, 4], 0),
        14: ([3, 4], 1),
        15: ([1, 4], -1),
    }
    assert snapshot["nodes"][1:3] == [[2, 117.202, 39.112], [3, 117.202, 39.112]]


def test_extract_keeps_separate_runs_when_a_road_reenters_the_bounds():
    osm = fromstring("""
        <osm>
          <node id="1" lon="117.200" lat="39.110"/>
          <node id="2" lon="117.202" lat="39.112"/>
          <node id="3" lon="117.224" lat="39.114"/>
          <node id="4" lon="117.204" lat="39.114"/>
          <node id="5" lon="117.208" lat="39.114"/>
          <node id="6" lon="117.221" lat="39.113"/>
          <way id="10">
            <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/>
            <tag k="highway" v="primary"/><tag k="oneway" v="-1"/>
          </way>
        </osm>
    """)

    snapshot = build_snapshot(osm, EXTRACTED_ON, landmarks=())

    assert snapshot["bounds"] == [117.192, 39.101, 117.221, 39.127]
    assert [point[0] for point in snapshot["nodes"]] == [1, 2, 4, 5, 6]
    assert [(road["id"], road["nodes"], road["oneway"]) for road in snapshot["roads"]] == [
        (10, [1, 2], -1),
        (10, [4, 5, 6], -1),
    ]
