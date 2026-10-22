/**
 * AI-feature review tests — personal verification suite, kept separate from the
 * main test suite (see docs/ai-feature-tests.md). Decoder contract for the
 * questions field on AI fill responses.
 */
import { requestAIDataUpdate } from '../../services/app.service';

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});

function respond(body: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test('a questions-only AI response is valid and carries no scenario', async () => {
  respond({ status: 'success', questions: ['Which unit should demand use?'], updateNotes: [] });
  const result = await requestAIDataUpdate(50011, 0, 'Fill');
  expect(result).toEqual({
    status: 'success',
    updateNotes: [],
    questions: ['Which unit should demand use?'],
  });
});
