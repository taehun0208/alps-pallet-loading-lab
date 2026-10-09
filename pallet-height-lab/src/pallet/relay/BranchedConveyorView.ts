import {tailGeometry,tailPoint} from './conveyorTail';
/* Hallmark · factory component · existing industrial scene tokens.
 * Pre-emit critique: P4 H4 E5 S5 R5 V4. Main trunk / sub-lines / rounded final merge / inlet inspection. */
import * as THREE from 'three';
import { beltBounds, CONVEYOR } from './conveyor';
import { BRANCH, mainY } from './branchedConveyor';
import { cellPose } from './layout';
import { robotCount } from './fleet';
import { SCANNER_OFFSET } from './intake';
import { rejectStation } from './rejectPallet';
import { TWIN_CONVEYOR, TWIN_ROBOT_PALETTE } from './twinSceneTheme';
import type { Pallet } from '../types';

export function createBranchedConveyorView(p: Pallet) {
  const group = new THREE.Group(); group.name = 'main-and-sub-conveyors';
  const bounds = beltBounds(p), deck = CONVEYOR.deck / 1000, y = mainY / 1000, width = CONVEYOR.width / 1000;
  const steel = new THREE.MeshStandardMaterial({ color: TWIN_ROBOT_PALETTE.steel, metalness: .65, roughness: .35 });
  const rubber = new THREE.MeshStandardMaterial({ color: TWIN_ROBOT_PALETTE.dark, roughness: .85 });
  const main = new THREE.MeshStandardMaterial({ color: TWIN_CONVEYOR.main, metalness: .25, roughness: .6 });
  const sub = new THREE.MeshStandardMaterial({ color: TWIN_CONVEYOR.sub, metalness: .25, roughness: .6 });
  const cube = (parent: THREE.Group, size: number[], at: number[], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), mat); mesh.position.set(...at as [number, number, number]); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  function lane(name: string, x: number, z: number, length: number, vertical: boolean, material: THREE.Material) {
    const root = new THREE.Group(); root.name = name; root.position.set(x, 0, z); if (vertical) root.rotation.y = -Math.PI / 2; group.add(root);
    cube(root, [length, .14, width], [0, deck - .07, 0], rubber);
    for (const side of [-1, 1]) cube(root, [length, .17, .055], [0, deck - .025, side * (width / 2 + .02)], material);
    for (let at = -length / 2 + .15; at < length / 2; at += .23) cube(root, [.013, .005, width - .05], [at, deck + .003, 0], steel);
    for (let at = -length / 2 + .25; at < length / 2; at += 1.4) for (const side of [-1, 1]) {
      cube(root, [.065, deck + .32, .065], [at, (deck - .4) / 2, side * .35], steel);
      cube(root, [.17, .04, .17], [at, -.385, side * .35], steel);
    }
  }
  const mainEnd = tailGeometry(p).right;
  lane('main-red-conveyor', (bounds.left + mainEnd) / 2000, y, (mainEnd - bounds.left) / 1000, false, main);
  for (let robot = 0; robot < robotCount(p); robot++) {
    const x = cellPose(robot, p).x / 1000;
    const final = robot === tailGeometry(p).robot;
    // The final station only has the pickup deck beyond the curve's endpoint.
    // A full straight lane here would create a second route to the same station.
    lane(`sub-blue-conveyor-${robot + 1}`, x, final ? CONVEYOR.front / 1000 + .225 : y + (BRANCH.length + 450) / 2000, final ? .45 : (BRANCH.length + 450) / 1000, true, sub);
    if (!final) cube(group, [.96, .08, .96], [x, deck - .04, y], sub); // powered right-angle transfer table
    cube(group, [.92, .03, .065], [x, deck + .05, CONVEYOR.front / 1000 + .45], sub);
    cube(group, [.09, .12, .08], [x + .51, deck + .08, CONVEYOR.front / 1000], steel);
  }
  // Smooth horizontal ribbon with rails: the same arc-length path as carton transport.
  const tail = new THREE.Group(); tail.name = 'rounded-end-to-last-sub'; group.add(tail);
  const curve = tailGeometry(p), vertices: number[] = [], indices: number[] = [], edges = [[], []] as THREE.Vector3[][];
  const steps = Math.ceil(curve.length / 90);
  for (let i = 0; i <= steps; i++) {
    const arc = curve.length * i / steps, pt = tailPoint(p, arc), a = tailPoint(p, Math.max(0, arc - 1)), b = tailPoint(p, Math.min(curve.length, arc + 1)), length = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    for (const [j, sign] of [-1, 1].entries()) { const x = (pt.x + nx * CONVEYOR.width / 2 * sign) / 1000, z = (pt.y + ny * CONVEYOR.width / 2 * sign) / 1000; vertices.push(x, deck, z); edges[j].push(new THREE.Vector3(x, deck + .05, z)); }
    if (i) { const n = i * 2; indices.push(n - 2, n - 1, n, n - 1, n + 1, n); }
    if (i % 3 === 0) { const roller = cube(tail, [.012, .008, width - .04], [pt.x / 1000, deck + .005, pt.y / 1000], steel); roller.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x); }
    if (i % 14 === 0) for (const sign of [-1, 1]) cube(tail, [.065, deck + .32, .065], [(pt.x + nx * 350 * sign) / 1000, (deck - .4) / 2, (pt.y + ny * 350 * sign) / 1000], steel);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color:TWIN_ROBOT_PALETTE.dark,roughness:.85,side:THREE.DoubleSide})); surface.receiveShadow = true; tail.add(surface);
  for (const points of edges) tail.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), steps, .035, 6, false), sub));
  const scanner = new THREE.Group(); scanner.name = 'main-inlet-u-scanner'; group.add(scanner);
  const scanX = (bounds.left + SCANNER_OFFSET) / 1000;
  for (const side of [-1, 1]) cube(scanner, [.22, 1.15, .13], [scanX, deck + .575, y + side * .58], rubber);
  cube(scanner, [.23, .15, 1.3], [scanX, deck + 1.15, y], steel);
  const signal = new THREE.MeshStandardMaterial({ color: TWIN_CONVEYOR.scan, emissive: TWIN_CONVEYOR.scan, emissiveIntensity: .2 });
  for (const side of [-1, 1]) cube(scanner, [.12, .28, .06], [scanX, deck + .45, y + side * .5], signal);
  cube(scanner, [.12, .06, .48], [scanX, deck + 1.04, y], signal);
  const laser = new THREE.Mesh(new THREE.PlaneGeometry(1.03, 1.02), new THREE.MeshBasicMaterial({ color: TWIN_CONVEYOR.scan, transparent: true, opacity: .08, side: THREE.DoubleSide, depthWrite: false }));
  laser.rotation.y = Math.PI / 2; laser.position.set(scanX, deck + .52, y); scanner.add(laser);
  const pushX = (bounds.left + BRANCH.pusherOffset) / 1000, pusher = new THREE.Group(); pusher.name = 'pre-branch-defect-pusher'; group.add(pusher);
  cube(pusher, [.42, .18, .6], [pushX, deck + .16, y + .8], steel);
  const paddle = cube(pusher, [.82, .26, .07], [pushX, deck + .15, y + .43], main);
  const rod = cube(pusher, [.055, .055, .35], [pushX, deck + .16, y + .62], steel);
  const target = rejectStation(p), startY = y - .48, endY = (target.y + p.depth / 2) / 1000;
  const reject = new THREE.Group(); reject.name = 'side-reject-roller-chute'; group.add(reject);
  const rollerMaterial = new THREE.MeshStandardMaterial({ color: TWIN_ROBOT_PALETTE.steel, metalness: .8, roughness: .25 });
  for (let z = startY; z >= endY; z -= .1) {
    const t = (startY - z) / (startY - endY), h = deck + (target.z / 1000 - deck) * t;
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(.033, .033, 1.02, 10), rollerMaterial); roller.rotation.z = Math.PI / 2; roller.position.set(pushX, h - .035, z); reject.add(roller);
  }
  for (const side of [-1, 1]) {
    const length = Math.hypot(startY - endY, deck - target.z / 1000), rail = cube(reject, [.06, .12, length], [pushX + side * .54, (deck + target.z / 1000) / 2 - .04, (startY + endY) / 2], main);
    rail.rotation.x = -Math.atan2(deck - target.z / 1000, startY - endY);
  }
  return { group, update: (_time: number, scanning = false, rejected = false, pushProgress = 0) => {
    signal.color.set(rejected ? TWIN_ROBOT_PALETTE.warning : TWIN_CONVEYOR.scan); signal.emissive.copy(signal.color); signal.emissiveIntensity = scanning ? .7 : .2;
    laser.material.opacity = scanning ? .2 : .06;
    const t = Math.max(0, Math.min(1, pushProgress)), stroke = t < .8 ? t / .8 : (1 - t) / .2;
    paddle.position.z = y + .43 - stroke * 1.05; rod.scale.z = 1 + stroke * 3; rod.position.z = y + .62 - stroke * .525;
  }, dispose: () => {} };
}
