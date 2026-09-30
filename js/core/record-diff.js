function recordsById(records) {
  return new Map((records || []).map(record => [String(record.id), record]));
}

function recordsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildRecordChanges(previous, current, modules) {
  const changes = { upserts: [], deletes: [] };

  for (const module of modules) {
    const before = recordsById(previous?.[module]);
    const after = recordsById(current?.[module]);

    for (const [recordId, record] of after) {
      if (!before.has(recordId) || !recordsEqual(before.get(recordId), record)) {
        changes.upserts.push({ module, recordId, record });
      }
    }

    for (const recordId of before.keys()) {
      if (!after.has(recordId)) changes.deletes.push({ module, recordId });
    }
  }

  return changes;
}

export function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
