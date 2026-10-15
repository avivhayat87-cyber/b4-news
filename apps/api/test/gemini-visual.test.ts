// The visual agent's Gemini adapter against a stand-in for Google's Interactions API.
import { describe, expect, it } from 'vitest';
import { GeminiVisual } from '../src/services/ai/gemini-visual';
import { imageErrorMessage } from '../src/services/image-brief';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stub(answer: () => Response) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, any> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return answer();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const answer = (data: unknown) =>
  json(200, {
    steps: [
      { type: 'thought', content: [{ type: 'text', text: 'thinking…' }] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(data) }] },
    ],
    usage: { total_input_tokens: 900, total_output_tokens: 60, total_thought_tokens: 40 },
  });

const article = { title: 'הריבית נשארה', subtitle: 'בנק ישראל', body: 'גוף הכתבה', section: 'כלכלה ישראלית' };

describe('Gemini visual agent', () => {
  it('asks for one Hebrew description per style as JSON, with the guidance, the pictures and what was tried', async () => {
    const { fn, calls } = stub(() =>
      answer({ prompts: ['בניין בנק ישראל בשעת בוקר', 'תקריב של מחשבון על שולחן', 'איור של גרף יציב'], public_figure: { name_he: 'אמיר ירון', name_en: 'Amir Yaron' } }),
    );
    const photo = Buffer.from([0xff, 0xd8, 0xff]);
    const res = await new GeminiVisual('key-123', 'gemini-3.8-flash', fn).imagePrompt({
      systemPrompt: 'You are the photo editor.',
      guidance: '- Article images: צילום ריאליסטי',
      styles: ['צילום', 'תקריב', 'איור'],
      article,
      images: [{ data: photo, mimeType: 'image/jpeg' }],
      tried: ['שטרות כסף על שולחן'],
    });
    expect(res.data.prompts).toEqual(['בניין בנק ישראל בשעת בוקר', 'תקריב של מחשבון על שולחן', 'איור של גרף יציב']);
    expect(res.data.public_figure).toEqual({ name_he: 'אמיר ירון', name_en: 'Amir Yaron' });
    expect(res.usage).toMatchObject({ model: 'gemini-3.8-flash', inputTokens: 900, outputTokens: 100 });

    const call = calls[0]!;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(call.headers['x-goog-api-key']).toBe('key-123');
    expect(call.body).toMatchObject({ model: 'gemini-3.8-flash', store: false, response_format: { type: 'text', mime_type: 'application/json', schema: { required: ['prompts', 'public_figure'] } } });
    expect(call.body.system_instruction).toContain('צילום ריאליסטי');
    expect(call.body.system_instruction).toContain('in Hebrew');
    expect(call.body.system_instruction).toContain('never the same picture three times');
    expect(call.body.input[0].text).toContain('<styles>\n1. צילום\n2. תקריב\n3. איור');
    expect(call.body.input[0].text).toContain('<tried>');
    expect(call.body.input[0].text).toContain('שטרות כסף על שולחן');
    expect(call.body.input[1]).toEqual({ type: 'image', mime_type: 'image/jpeg', data: photo.toString('base64') });
  });

  it('looks at the options, each after its label, and picks one', async () => {
    const { fn, calls } = stub(() => answer({ choice: 2, reason: 'הצילום של הנגיד ברור ועדכני' }));
    const img = { data: Buffer.from('jpeg'), mimeType: 'image/jpeg' };
    const res = await new GeminiVisual('k', 'm', fn).pickImage({
      systemPrompt: 'בחר תמונה.',
      guidance: '',
      article,
      options: [
        { label: 'מצויר, בסגנון: צילום', image: img },
        { label: 'צילום אמיתי של אמיר ירון', image: img },
      ],
    });
    expect(res.data).toEqual({ choice: 2, reason: 'הצילום של הנגיד ברור ועדכני' });
    const input = calls[0]!.body.input as { type: string; text?: string }[];
    expect(input.map((c) => c.type)).toEqual(['text', 'text', 'image', 'text', 'image']);
    expect(input[3]!.text).toBe('Option 2: צילום אמיתי של אמיר ירון');
  });

  it('learns from the cases with their pictures, each after its label', async () => {
    const { fn, calls } = stub(() => answer({ rules: '1. מקומות אמיתיים', summary: 'העורכים העדיפו צילום.' }));
    const img = { data: Buffer.from('jpeg'), mimeType: 'image/jpeg' };
    const res = await new GeminiVisual('k', 'm', fn).learn({
      systemPrompt: 'You learn.',
      currentRules: '',
      settings: '(none)',
      cases: [{ text: 'Article image…', images: [{ label: 'the image the editor chose', image: img }] }],
    });
    expect(res.data).toEqual({ rules: '1. מקומות אמיתיים', summary: 'העורכים העדיפו צילום.' });
    const input = calls[0]!.body.input as { type: string; text?: string }[];
    expect(input.map((c) => c.type)).toEqual(['text', 'text', 'text', 'image']);
    expect(input[1]!.text).toContain('<case_1>');
    expect(input[2]!.text).toBe('Case 1, the image the editor chose:');
  });

  it('says in Hebrew why it failed', async () => {
    const { fn } = stub(() => json(429, { error: { message: 'Quota exceeded (limit: 0, free tier)' } }));
    const failed = await new GeminiVisual('k', 'm', fn).imagePrompt({ systemPrompt: '', guidance: '', styles: [], article, images: [], tried: [] }).catch((e: Error) => e.message);
    expect(imageErrorMessage(String(failed))).toContain('Billing');
    const missing = stub(() => json(404, { error: { message: 'model not found' } }));
    const gone = await new GeminiVisual('k', 'gemini-9', missing.fn).imagePrompt({ systemPrompt: '', guidance: '', styles: [], article, images: [], tried: [] }).catch((e: Error) => e.message);
    expect(imageErrorMessage(String(gone))).toContain('המודל של סוכן התמונות');
  });
});
