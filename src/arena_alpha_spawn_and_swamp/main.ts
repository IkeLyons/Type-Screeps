import { ATTACK, CARRY, ERR_NOT_IN_RANGE, HEAL, MOVE, RESOURCE_ENERGY } from "game/constants";
import { Creep, StructureContainer, StructureSpawn } from "game/prototypes";
import { findInRange, getObjectsByPrototype } from "game/utils";

declare module "game/prototypes" {
  interface Creep {
    waitingForSquad: boolean;
  }
}

let workers: Creep[] = [];
let army: Creep[] = [];
let currentSquad: Creep[] = [];
let containers: StructureContainer[] = [];
let mySpawn: StructureSpawn | undefined;
let enemySpawn: StructureSpawn | undefined;
let spawnDelay = 0;
const squadSize = 4;
const workerCount = 3;
const attackCreepBody = [MOVE, MOVE, MOVE, MOVE, ATTACK, ATTACK, ATTACK, ATTACK];
const healCreepBody = [MOVE, MOVE, MOVE, HEAL, HEAL];

function spawnCreepLogic() {
  if (mySpawn) {
    if (workers.length < workerCount) {
      const worker: Creep | undefined = mySpawn.spawnCreep([MOVE, CARRY, MOVE]).object;
      if (worker) {
        workers.push(worker);
      }
    } else {
      let attackCreep: Creep | undefined;
      let typeCreated; // 0 - Attacker | 1 - Healer
      if (currentSquad.length < squadSize - 1) {
        attackCreep = mySpawn.spawnCreep(attackCreepBody).object;
      } else if (currentSquad.length < squadSize) {
        attackCreep = mySpawn.spawnCreep(healCreepBody).object;
      }
      if (attackCreep) {
        attackCreep.waitingForSquad = true;
        currentSquad.push(attackCreep);
        if (typeCreated === 0) {
          spawnDelay = attackCreepBody.length * 3;
        } else if (typeCreated === 1) {
          spawnDelay = healCreepBody.length * 3;
        }
      }
    }
  }
}

function deploySquad(forced: boolean) {
  if (currentSquad.length >= squadSize || forced) {
    if (spawnDelay > 0) {
      spawnDelay--;
      return;
    }
    for (const creep of currentSquad) {
      creep.waitingForSquad = false;
    }

    army = army.concat(currentSquad);
    currentSquad = [];
  }
}

function getCloseEnergy(spawn: StructureSpawn, conts: StructureContainer[]) {
  conts = findInRange(spawn, conts, 5);
  const energy = conts.reduce((n, { store }) => n + store[RESOURCE_ENERGY], 0);
  return energy;
}

function init() {
  mySpawn = getObjectsByPrototype(StructureSpawn).find(i => i.my);
  enemySpawn = getObjectsByPrototype(StructureSpawn).find(i => !i.my);
  workers = workers.filter(creep => creep.exists);
  army = army.filter(creep => creep.exists);
  containers = getObjectsByPrototype(StructureContainer);

  if (mySpawn) {
    const remainingCloseEnergy = getCloseEnergy(mySpawn, containers);
    if (remainingCloseEnergy === 0) {
      deploySquad(true);
    } else {
      deploySquad(false);
    }
  }
}

export function loop() {
  init();

  for (const worker of workers) {
    if (worker.store.getFreeCapacity(RESOURCE_ENERGY)) {
      const nonEmptyConts = containers.filter(c => c.store[RESOURCE_ENERGY] > 0);
      const container = worker.findClosestByPath(nonEmptyConts);
      if (container && worker.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        worker.moveTo(container);
      }
    } else {
      if (mySpawn && worker.transfer(mySpawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        worker.moveTo(mySpawn);
      }
    }
  }

  const enemies: (StructureSpawn | Creep)[] = getObjectsByPrototype(Creep).filter(c => !c.my);
  if (enemySpawn) enemies.push(enemySpawn);
  for (const creep of army) {
    if (creep.waitingForSquad) {
      continue;
    }
    if (creep.body.some(bp => bp.type === HEAL)) {
      const myDamagedCreeps = army.filter(i => i.hits < i.hitsMax);
      const healTarget = creep.findClosestByPath(myDamagedCreeps);

      if (healTarget && creep.id !== healTarget.id) {
        if (creep.heal(healTarget) === ERR_NOT_IN_RANGE) {
          creep.moveTo(healTarget);
        }
        continue;
      } else if (!healTarget) {
        const closestAlly = creep.findClosestByPath(army.filter(c => c.id !== creep.id));
        if (closestAlly) creep.moveTo(closestAlly);
      }
    }
    if (creep.body.some(bp => bp.type === ATTACK)) {
      const enemy = creep.findClosestByPath(enemies);
      if (enemy && creep.attack(enemy) === ERR_NOT_IN_RANGE) {
        creep.moveTo(enemy);
      }
    }
  }

  spawnCreepLogic();
}
