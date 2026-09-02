# types.ts

The frozen cross-module contract for the whole project: the shapes that Terrain,
Forest, the fire sim and the Scene all agree on. Data flows one direction,
Terrain -> Forest -> Fire sim -> Scene, and this file is the only thing those
modules share. It is deliberately edited before parallel implementation work
starts and left alone afterwards, because three modules are built against it
simultaneously and a silent change desynchronises all of them.

Imports no libraries. Types only, no runtime code except the three cell-state
constants (`UNBURNED`, `BURNING`, `CHARRED`) used by the parallel-array
encoding in `FireSim`.
