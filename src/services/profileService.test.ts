const mockMaybeSingle = jest.fn<Promise<{ data: unknown; error: unknown }>, []>();
const mockSelectEq = jest.fn<{ maybeSingle: typeof mockMaybeSingle }, [string]>(() => ({
  maybeSingle: mockMaybeSingle
}));
const mockSelect = jest.fn<{ eq: typeof mockSelectEq }, [string]>(() => ({
  eq: mockSelectEq
}));
const mockUpdateEq = jest.fn<Promise<{ error: unknown }>, [string, string]>();
const mockUpdate = jest.fn<{ eq: typeof mockUpdateEq }, [{ memory_facts: string[] }]>(() => ({
  eq: mockUpdateEq
}));
const mockFrom = jest.fn<{ select: typeof mockSelect; update: typeof mockUpdate }, [string]>(() => ({
  select: mockSelect,
  update: mockUpdate
}));

jest.mock('./supabaseClient', () => ({
  assertSupabaseConfigured: jest.fn(),
  supabase: {
    from: (table: string) => mockFrom(table)
  }
}));

import { fetchProfile, saveMemoryFacts } from './profileService';

describe('profileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateEq.mockResolvedValue({ error: null });
  });

  it('maps memory_facts from profiles row', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'user-1',
        age: 33,
        sex: 'female',
        relationship_status: 'single',
        horoscope_sign: 'leo',
        interests: ['humour'],
        memory_facts: [' Je vis a Montreal ', 'je vis a montreal', "J'aime le cafe"],
        onboarding_completed: true,
        onboarding_skipped: false
      },
      error: null
    });

    const profile = await fetchProfile('user-1');

    expect(profile).not.toBeNull();
    expect(profile?.memoryFacts).toEqual(['Je vis a Montreal', "J'aime le cafe"]);
  });

  it('normalizes, deduplicates and caps facts when saving memory_facts', async () => {
    const manyFacts = Array.from({ length: 40 }, (_, index) => `Je suis fait-${index}`);
    await saveMemoryFacts(' user-1 ', ['  Je vis a Quebec  ', 'je vis a quebec', ...manyFacts, '', '   ']);

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const payload = mockUpdate.mock.calls[0]?.[0];
    if (!payload) {
      throw new Error('Expected update payload');
    }
    expect(Array.isArray(payload.memory_facts)).toBe(true);
    expect(payload.memory_facts[0]).toBe('Je vis a Quebec');
    expect(payload.memory_facts).toHaveLength(30);
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-1');
  });
});
