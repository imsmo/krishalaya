import { countByStatus } from '../features/insights/summarise';

describe('features/insights/summarise (OW-6)', () => {
  it('counts by status, sorted descending, ignoring malformed rows', () => {
    const rows = [
      { status: 'stored' }, { status: 'requested' }, { status: 'stored' },
      { status: '' }, { status: undefined as unknown as string }, { status: 'released' }, { status: 'stored' },
    ];
    expect(countByStatus(rows)).toEqual([
      { status: 'stored', count: 3 },
      { status: 'requested', count: 1 },
      { status: 'released', count: 1 },
    ]);
    expect(countByStatus([])).toEqual([]);
  });
});
