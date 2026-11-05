export const ASH_DOORS = ["STATUS", "SONG", "DIARY", "REVIEWS", "BOOKS", "HERALD", "NOTES"] as const;
export type AshDoor = (typeof ASH_DOORS)[number];

const ALLOWED_DOORS = new Set<string>(ASH_DOORS);

export function launchDoorFollowUps(
  doors: readonly AshDoor[],
  runDoor: (door: AshDoor) => Promise<void>,
  onFailure: (door: AshDoor, error: unknown) => void,
): Promise<void> {
  return Promise.all(doors.map((door) =>
    Promise.resolve()
      .then(() => runDoor(door))
      .catch((error) => onFailure(door, error)),
  )).then(() => undefined);
}

export function extractOpenDoors(reply: string): { doors: AshDoor[]; text: string } {
  const doors: AshDoor[] = [];
  const kept: string[] = [];
  for (const line of reply.split("\n")) {
    const match = line.match(/^\s*OPEN:\s*(.+?)\s*$/i);
    if (!match) {
      kept.push(line);
      continue;
    }
    const name = match[1]!.toUpperCase();
    if (doors.length < 2 && ALLOWED_DOORS.has(name)) doors.push(name as AshDoor);
  }
  return {
    doors,
    text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
