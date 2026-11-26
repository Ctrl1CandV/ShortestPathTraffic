import test from 'node:test';
import assert from 'node:assert/strict';
import {warshall, nearestNeighbor, hungarian, sequentialColoring, preorderSearch} from '../web/algorithms.mjs';

test('Warshall: new reachability belongs to the correct intermediate round', () => {
  const s = warshall(4, [[0,1], [1,2], [2,3]]);
  assert.equal(s.length, 5);
  assert.deepEqual(s[0].matrix[0], [true,true,false,false]);
  assert.deepEqual(s[2].added, [[0,2]]);
  assert.deepEqual(s[3].added, [[0,3],[1,3]]);
  assert.deepEqual(s.at(-1).matrix[3], [false,false,false,true]);
  assert.deepEqual(warshall(3, [[0,1]]).at(-1).matrix[0], [true,true,false]);
});

test('nearest neighbor uses enabled stations only, adds the return leg, handles empty and ties', () => {
  const p = [[0,0],[3,0],[3,4],[0,4]].map(([x,y]) => ({x,y}));
  const steps = nearestNeighbor(p, 0, [3,2,1]);
  assert.deepEqual(steps.map(s => s.leg), [0,3,4,3,4]);
  assert.deepEqual(steps.at(-1), {route:[0,1,2,3,0], leg:4, distance:14});
  assert.deepEqual(nearestNeighbor(p,0,[]).at(-1).route, [0]);
  assert.deepEqual(nearestNeighbor(p,0,[2]).at(-1), {route:[0,2,0], leg:5, distance:10});
  assert.equal(nearestNeighbor([{x:0,y:0},{x:1,y:0},{x:-1,y:0}],0,[2,1])[1].route.at(-1),1);
});

test('Hungarian augmentation reassigns an occupied job; deleting eligibility reduces cardinality', () => {
  const s = hungarian(2,2,[[0,0],[0,1],[1,0]]);
  assert.deepEqual(s[1].matching,[0,-1]);
  assert.deepEqual(s[2].path,[[1,0],[0,1]]);
  assert.deepEqual(s[2].matching,[1,0]);
  assert.deepEqual(hungarian(2,2,[[0,0],[1,0]]).at(-1).matching,[0,-1]);
  assert.deepEqual(hungarian(2,2,[]).at(-1).matching,[-1,-1]);
});

test('sequential coloring: order changes number of colors without any adjacent conflict', () => {
  const borders = [[0,1],[1,2],[2,3]];
  for (const [order, colors] of [[[0,1,2,3],[1,2,1,2]], [[0,3,1,2],[1,2,3,1]]]) {
    const s = sequentialColoring(4,borders,order);
    assert.deepEqual(s[0].colors,[0,0,0,0]);
    assert.deepEqual(s.at(-1).colors,colors);
    for (const [a,b] of borders) assert.notEqual(colors[a],colors[b]);
  }
  assert.deepEqual(sequentialColoring(1,[],[0]).at(-1).colors,[1]);
});

test('preorder searches every file in scope even after first hit; empty query lists all', () => {
  const tree = [[ [1,2], ['笔记'] ],[[3],['算法表']], [[],['算法题']], [[],['作业']]].map(([children,records])=>({children,records}));
  const s = preorderSearch(tree,0,'算法');
  assert.deepEqual(s[0].visited,[]);
  assert.deepEqual(s.at(-1).visited,[0,1,3,2]);
  assert.deepEqual(s.at(-1).hits,[{id:1,name:'算法表'},{id:2,name:'算法题'}]);
  assert.deepEqual(preorderSearch(tree,1,'').at(-1).visited,[1,3]);
  assert.equal(preorderSearch(tree,1,'').at(-1).hits.length,2);
  assert.deepEqual(preorderSearch(tree,1,'图论').at(-1).hits,[]);
});

// Regression checks against the larger inputs actually imported by the page.
import {people,contacts,activeContacts,stores,dailyOrders,workers,jobs,qualifications,district,archive} from '../web/examples.mjs';

test('three clubs: losing the only outbound bridge cuts off two entire clubs', () => {
  const flags = [...activeContacts];
  const reachable = () => warshall(people.length,contacts.filter((_,i) => flags[i])).at(-1).matrix[0].slice(1).filter(Boolean).length;
  assert.equal(reachable(),14); flags[0]=false; assert.equal(reachable(),4); flags[2]=true; assert.equal(reachable(),14);
});

test('delivery: a pickup changes the next decision, not only the route length', () => {
  for (const [orders,third,total] of [[dailyOrders,2,'126.9'],[[...dailyOrders,13],13,'123.3']]) {
    const {route,distance} = nearestNeighbor(stores,0,orders).at(-1);
    assert.equal(route[0],0); assert.equal(route.at(-1),0); assert.deepEqual(route.slice(1,-1).sort((a,b)=>a-b),orders);
    assert.equal(route[2],third); assert.equal(distance.toFixed(1),total);
  }
  const manual = [0,1,2,3,4,5,6,7,8,9,12,10,11,0];
  assert.deepEqual(manual.slice(1,-1).sort((a,b)=>a-b),dailyOrders);
  assert.equal(manual.slice(1).reduce((sum,id,i) => sum + Math.hypot(stores[id].x-stores[manual[i]].x,stores[id].y-stores[manual[i]].y),0).toFixed(1),'95.6');
});

test('open day: seven-person augmentation and the sole live-stream qualification', () => {
  const edges=qualifications.flatMap((row,i)=>row.map(j=>[i,j]));
  const run=es=>hungarian(workers.length,jobs.length,es).at(-1);
  const last=run(edges); assert.equal(last.path.length,7); assert.equal(new Set(last.matching).size,8); assert.ok(!last.matching.includes(-1));
  assert.equal(run(edges.filter(([i,j]) => i!==6 || j!==7)).matching.filter(j=>j>=0).length,7);
});

test('all 30 model borders are exactly the shared polygon edges; swapping I/J costs one color', () => {
  const sides=district.shapes.map(p=>new Set(p.map((a,i)=>[a.join(','),p[(i+1)%p.length].join(',')].sort().join('|'))));
  const shared=[];
  for(let i=0;i<sides.length;i++) for(let j=0;j<i;j++) if([...sides[i]].some(e=>sides[j].has(e))) shared.push([i,j]);
  assert.equal(shared.length,30); assert.deepEqual(shared,district.borders);
  for(const [letters,n] of [['ABCDEFGHIJKLMNO',4],['ABCDEFGHJIKLMNO',5]]) {
    const r=sequentialColoring(15,shared,[...letters].map(c=>c.charCodeAt(0)-65)).at(-1);
    assert.equal(Math.max(...r.colors),n); for(const [a,b] of shared) assert.notEqual(r.colors[a],r.colors[b]);
  }
});

test('archive: subtree and filename change independent dimensions of the result', () => {
  const search=(root,q)=>preorderSearch(archive,root,q).at(-1);
  for(const [root,q,dirs,hits] of [[0,'算法',21,7],[2,'算法',11,3],[12,'算法',3,1],[12,'数据包',3,3],[12,'不存在',3,0]]) {
    const r=search(root,q); assert.equal(r.visited.length,dirs); assert.equal(new Set(r.visited).size,dirs); assert.equal(r.hits.length,hits);
  }
});

function permutations(xs) {
  return xs.length ? xs.flatMap(x => permutations(xs.filter(y => y !== x)).map(rest => [x, ...rest])) : [[]];
}

const four = [0, 1, 2, 3];
const pairs = four.flatMap(i => four.map(j => [i, j]));
const orders = permutations(four);

// These independent oracles run only in tests, never in the classroom page.
test('Warshall agrees with reachability by traversal on every four-vertex digraph without loops', () => {
  const arcs = pairs.filter(([i,j]) => i !== j);
  for (let mask = 0; mask < 2 ** arcs.length; mask++) {
    const edges = arcs.filter((_, i) => mask & (1 << i));
    const matrix = warshall(4, edges).at(-1).matrix;
    for (const source of four) {
      const seen = new Set([source]);
      for (const vertex of seen) for (const [a,b] of edges) if (a === vertex) seen.add(b);
      assert.deepEqual(matrix[source], four.map(i => seen.has(i)), `mask=${mask}, source=${source}`);
    }
  }
});

test('every 4-by-4 eligibility matrix agrees with exhaustive assignment', () => {
  // A partial matching can be extended to a permutation if missing pairs are allowed.
  // Count only eligible pairs in each permutation; the best count is the true maximum.
  const assignments = orders.map(order => order.map((j,i) => 1 << (4*i+j)));
  for (let mask = 0; mask < 65536; mask++) {
    const allowed = pairs.filter((_,i) => mask & (1 << i));
    const actual = hungarian(4,4,allowed).at(-1).matching;
    const jobs = actual.filter(j => j >= 0);
    assert.equal(new Set(jobs).size, jobs.length, `duplicate job: mask=${mask}`);
    assert.ok(actual.every((j,i) => j < 0 || (mask & (1 << (4*i+j)))), `ineligible: mask=${mask}`);
    const maximum = Math.max(...assignments.map(bits => bits.reduce((n,bit) => n + Number(Boolean(mask & bit)), 0)));
    assert.equal(jobs.length, maximum, `mask=${mask}`);
  }
});

test('first-fit chooses the least available color at each step of all orders on every four-region graph', () => {
  const possible = pairs.filter(([a,b]) => a < b);
  for (let mask = 0; mask < 2 ** possible.length; mask++) {
    const borders = possible.filter((_, i) => mask & (1 << i));
    for (const order of orders) {
      const steps = sequentialColoring(4,borders,order);
      order.forEach((v,i) => {
        const previous = steps[i].colors;
        const forbidden = borders.filter(e => e.includes(v)).map(([a,b]) => previous[a === v ? b : a]);
        const expected = [1,2,3,4].find(c => !forbidden.includes(c));
        assert.deepEqual(steps[i+1].colors, previous.map((c,j) => j === v ? expected : c));
      });
    }
  }
});
