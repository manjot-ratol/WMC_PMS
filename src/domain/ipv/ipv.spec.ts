import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { evaluateIpv } from './additional-verification';
import { loadIpvRulebook } from './ipv-rulebook';

describe('evaluateIpv', () => {
  const rb = loadIpvRulebook();
  it('passes when liveness and face match clear their thresholds', () => {
    expect(
      evaluateIpv(
        { result: 'PASS', score: 90 },
        { matchResult: 'matched', confidence: 85 },
        rb,
      ),
    ).toEqual({ status: 'PASSED' });
  });
  it('fails on weak liveness or mismatch; reviews on inconclusive or missing reference', () => {
    expect(
      evaluateIpv(
        { result: 'FAIL', score: 20 },
        { matchResult: 'matched', confidence: 99 },
        rb,
      ),
    ).toMatchObject({ status: 'FAILED', category: 'liveness_failed' });
    expect(
      evaluateIpv({ result: 'PASS', score: 50 }, undefined, rb),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      evaluateIpv(
        { result: 'PASS', score: 90 },
        { matchResult: 'matched', confidence: 50 },
        rb,
      ),
    ).toMatchObject({ status: 'FAILED', category: 'face_mismatch' });
    expect(
      evaluateIpv(
        { result: 'PASS', score: 90 },
        { matchResult: 'not_matched', confidence: 40 },
        rb,
      ),
    ).toMatchObject({ status: 'FAILED' });
    expect(
      evaluateIpv({ result: 'UNKNOWN', score: 0 }, undefined, rb),
    ).toMatchObject({
      status: 'REVIEW_REQUIRED',
      category: 'liveness_inconclusive',
    });
    expect(
      evaluateIpv({ result: 'PASS', score: 90 }, undefined, rb),
    ).toMatchObject({
      status: 'REVIEW_REQUIRED',
      category: 'no_reference_image',
    });
    expect(
      evaluateIpv(
        { result: 'PASS', score: 90 },
        { matchResult: 'failed', confidence: 0 },
        rb,
      ),
    ).toMatchObject({ status: 'REVIEW_REQUIRED' });
  });
  it('rulebook loader validates required keys', () => {
    expect(() => loadIpvRulebook('/dev/null')).toThrow();
    const tmp = path.join(os.tmpdir(), `ipv-${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ version: 'x' }));
    expect(() => loadIpvRulebook(tmp)).toThrow(/missing "minLivenessScore"/);
    fs.unlinkSync(tmp);
  });
});
