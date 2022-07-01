import {
  ATTACK,
  BodyPartConstant,
  CARRY,
  ERR_NOT_IN_RANGE,
  HEAL,
  MOVE,
  RANGED_ATTACK,
  RESOURCE_ENERGY
} from "game/constants";
import { Creep, StructureContainer, StructureSpawn } from "game/prototypes";
import { findInRange, getObjectsByPrototype } from "game/utils";

// Needed by TS to define the custom attribute we use overtop of the standard creep object
declare module "game/prototypes" {
  interface Creep {
    waitingForSquad: boolean;
    role: string;
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
const attackCreepBody: BodyPartConstant[] = [MOVE, MOVE, MOVE, MOVE, ATTACK, ATTACK, ATTACK, ATTACK];
const healCreepBody: BodyPartConstant[] = [MOVE, MOVE, MOVE, HEAL, HEAL];
const kiterCreepBody: BodyPartConstant[] = [MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, HEAL, RANGED_ATTACK];

function spawnCreepLogic() {
  if (mySpawn) {
    if (workers.length < workerCount) {
      // Start off by spawning all the needed workers
      const newlySpawnedWorker: Creep | undefined = mySpawn.spawnCreep([MOVE, CARRY, MOVE]).object;
      if (newlySpawnedWorker) {
        workers.push(newlySpawnedWorker);
      }
    } else {
      // First choose what type of attacker we are spawning then spawn it
      let selectedBody: BodyPartConstant[];
      let role: string;
      if (currentSquad.length < squadSize - 1) {
        selectedBody = [...attackCreepBody];
        role = "grunt";
      } else {
        selectedBody = [...healCreepBody];
        role = "healer";
      }
      selectedBody = [...kiterCreepBody];
      role = "kiter";

      const attackCreep = mySpawn.spawnCreep(selectedBody).object;
      if (attackCreep) {
        attackCreep.waitingForSquad = true;
        attackCreep.role = role;
        currentSquad.push(attackCreep);
        spawnDelay = selectedBody.length * 3;
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

function work(worker: Creep) {
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

function attack(creep: Creep, enemies: (StructureSpawn | Creep)[]) {
  if (creep.waitingForSquad) {
    return;
  }
  if (creep.role === "kiter") {
    const targetsInRange = findInRange(creep, enemies, 3);
    if (targetsInRange.length >= 3) {
      creep.rangedMassAttack();
    } else if (targetsInRange.length > 0) {
      creep.rangedAttack(targetsInRange[0]);
    } else {
      const enemy = creep.findClosestByPath(enemies);
      if (enemy) creep.moveTo(enemy);
    }
    creep.heal(creep);
  }
  if (creep.role === "healer") {
    const myDamagedCreeps = army.filter(i => i.hits < i.hitsMax);
    const healTarget = creep.findClosestByPath(myDamagedCreeps);

    if (healTarget && creep.id !== healTarget.id) {
      if (creep.heal(healTarget) === ERR_NOT_IN_RANGE) {
        creep.moveTo(healTarget);
      }
      return;
    } else if (!healTarget) {
      const closestAlly = creep.findClosestByPath(army.filter(c => c.id !== creep.id));
      if (closestAlly) creep.moveTo(closestAlly);
    }
  }
  if (creep.role === "grunt") {
    const enemy = creep.findClosestByPath(enemies);
    if (enemy && creep.attack(enemy) === ERR_NOT_IN_RANGE) {
      creep.moveTo(enemy);
    }
  }
}

export function loop() {
  init();

  for (const creep of workers) {
    work(creep);
  }

  // Get all enemies but also push the spawn as an enemy so that the army will eventually target it
  const enemies: (StructureSpawn | Creep)[] = getObjectsByPrototype(Creep).filter(c => !c.my);
  if (enemySpawn) enemies.push(enemySpawn);

  for (const creep of army) {
    attack(creep, enemies);
  }

  spawnCreepLogic();
}
