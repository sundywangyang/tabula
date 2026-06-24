/**
 * G015: checksum handler 单测
 *
 * 覆盖:
 * - sha256 流式处理:createReadStream 发出两个 chunk → hash.update 被两次
 * - 默认算法:不传 algorithm → sha256
 * - sha1 算法:algorithm='sha1' → hash.update 用 sha1 实例
 * - md5 算法:algorithm='md5' → hash.update 用 md5 实例
 * - stream end → 返回 ok=true + hash + size + durationMs
 * - stream error → 返回 ok=false (IO_ERROR 透传)
 * - statSync throws ENOENT → 返回 ok=false (ENOENT 透传)
 * - 不支持的算法 → Result.error UNKNOWN
 * - 空 path → Result.error UNKNOWN
 */
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { handleChecksum } from '../handlers';
import type {
  FsChecksumRequest,
  FsChecksumResult,
  FsError,
  Result,
} from '@tabula/bridge';
import type { Hash } from 'node:crypto';

function makeReq(overrides: Partial<FsChecksumRequest> = {}): FsChecksumRequest {
  return { path: '/tmp/file.bin', ...overrides };
}

/** 模拟 ReadStream:支持 emit('data'|'end'|'error') */
function makeFakeStream() {
  const emitter = new EventEmitter();
  // ReadStream 需要 pipe/destroy 等方法;这里给最小 mock
  return Object.assign(emitter, {
    pipe: vi.fn(),
    destroy: vi.fn(),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
  });
}

/** 模拟 Hash:记录所有 update 调用 + 返回固定 digest */
function makeFakeHash(digestHex = 'deadbeef') {
  const updates: Array<Buffer | string> = [];
  const hash: Pick<Hash, 'update' | 'digest'> = {
    update: vi.fn((chunk: Buffer | string) => {
      updates.push(chunk);
      return hash;
    }) as unknown as Hash['update'],
    digest: vi.fn((_enc: string) => digestHex) as unknown as Hash['digest'],
  };
  return { hash: hash as unknown as Hash, updates };
}

describe('handleChecksum (G015)', () => {
  it('sha256 默认算法:createReadStream 发出 hello/world → hash.update 收到两个 chunk', async () => {
    const stream = makeFakeStream();
    const createReadStream = vi.fn().mockReturnValue(stream);
    const fake = makeFakeHash('cafebabe');
    const createHash = vi.fn().mockReturnValue(fake.hash);
    const statSync = vi.fn().mockReturnValue({ size: 10 });

    const promise = handleChecksum(makeReq(), createReadStream, createHash, statSync);
    // 触发 data x2 + end
    stream.emit('data', Buffer.from('hello'));
    stream.emit('data', Buffer.from('world'));
    stream.emit('end');

    const res = (await promise) as Result<FsChecksumResult>;

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.algorithm).toBe('sha256');
      expect(res.data.hash).toBe('cafebabe');
      expect(res.data.size).toBe(10);
      expect(res.data.path).toBe('/tmp/file.bin');
      expect(typeof res.data.durationMs).toBe('number');
    }
    expect(createHash).toHaveBeenCalledWith('sha256');
    expect(createReadStream).toHaveBeenCalledWith('/tmp/file.bin');
    expect(statSync).toHaveBeenCalledWith('/tmp/file.bin');
    expect(fake.updates).toHaveLength(2);
    expect(Buffer.concat(fake.updates as Buffer[]).toString()).toBe('helloworld');
  });

  it('algorithm=sha1 → createHash 用 sha1,Result.algorithm 报告 sha1', async () => {
    const stream = makeFakeStream();
    const createReadStream = vi.fn().mockReturnValue(stream);
    const fake = makeFakeHash('1111');
    const createHash = vi.fn().mockReturnValue(fake.hash);
    const statSync = vi.fn().mockReturnValue({ size: 0 });

    const promise = handleChecksum(
      makeReq({ algorithm: 'sha1' }),
      createReadStream,
      createHash,
      statSync,
    );
    stream.emit('end');

    const res = (await promise) as Result<FsChecksumResult>;

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.algorithm).toBe('sha1');
      expect(res.data.hash).toBe('1111');
    }
    expect(createHash).toHaveBeenCalledWith('sha1');
  });

  it('algorithm=md5 → createHash 用 md5', async () => {
    const stream = makeFakeStream();
    const createReadStream = vi.fn().mockReturnValue(stream);
    const fake = makeFakeHash('5d41402abc4b2a76b9719d911017c592');
    const createHash = vi.fn().mockReturnValue(fake.hash);
    const statSync = vi.fn().mockReturnValue({ size: 5 });

    const promise = handleChecksum(
      makeReq({ algorithm: 'md5' }),
      createReadStream,
      createHash,
      statSync,
    );
    stream.emit('end');

    const res = (await promise) as Result<FsChecksumResult>;

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.algorithm).toBe('md5');
      expect(res.data.hash).toBe('5d41402abc4b2a76b9719d911017c592');
    }
    expect(createHash).toHaveBeenCalledWith('md5');
  });

  it('流成功结束 → 返回 ok=true + hash', async () => {
    const stream = makeFakeStream();
    const createReadStream = vi.fn().mockReturnValue(stream);
    const fake = makeFakeHash('abcdef');
    const createHash = vi.fn().mockReturnValue(fake.hash);
    const statSync = vi.fn().mockReturnValue({ size: 42 });

    const promise = handleChecksum(makeReq(), createReadStream, createHash, statSync);
    // 触发 data + end
    stream.emit('data', Buffer.from('chunk'));
    stream.emit('end');

    const res = await promise;
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.hash).toBe('abcdef');
      expect(res.data.size).toBe(42);
    }
    expect(fake.updates).toHaveLength(1);
    expect((fake.updates[0] as Buffer).toString()).toBe('chunk');
  });

  it('流 emit error → 返回 ok=false,error.code=IO_ERROR(无 errno)', async () => {
    const stream = makeFakeStream();
    const createReadStream = vi.fn().mockReturnValue(stream);
    const fake = makeFakeHash();
    const createHash = vi.fn().mockReturnValue(fake.hash);
    const statSync = vi.fn().mockReturnValue({ size: 1 });

    const promise = handleChecksum(makeReq({ path: '/tmp/x' }), createReadStream, createHash, statSync);
    stream.emit('error', new Error('read failed'));

    const res = (await promise) as Result<FsChecksumResult>;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('IO_ERROR');
      expect((res.error as FsError).message).toBe('read failed');
      expect((res.error as FsError).path).toBe('/tmp/x');
    }
  });

  it('statSync throws ENOENT → 返回 ok=false,error.code=ENOENT', async () => {
    const e = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const createReadStream = vi.fn();
    const createHash = vi.fn();
    const statSync = vi.fn().mockImplementation(() => {
      throw e;
    });

    const res = (await handleChecksum(
      makeReq({ path: '/nope/missing.bin' }),
      createReadStream,
      createHash,
      statSync,
    )) as Result<FsChecksumResult>;

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('ENOENT');
      expect((res.error as FsError).path).toBe('/nope/missing.bin');
    }
    expect(createReadStream).not.toHaveBeenCalled();
    expect(createHash).not.toHaveBeenCalled();
  });

  it('不支持的 algorithm → Result.error UNKNOWN,不调底层 IO', async () => {
    const createReadStream = vi.fn();
    const createHash = vi.fn();
    const statSync = vi.fn();

    const res = (await handleChecksum(
      // @ts-expect-error testing invalid algo
      makeReq({ algorithm: 'whirlpool' }),
      createReadStream,
      createHash,
      statSync,
    )) as Result<FsChecksumResult>;

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
      expect((res.error as FsError).message).toContain('unsupported');
    }
    expect(statSync).not.toHaveBeenCalled();
    expect(createHash).not.toHaveBeenCalled();
  });

  it('空 path → Result.error UNKNOWN', async () => {
    const createReadStream = vi.fn();
    const createHash = vi.fn();
    const statSync = vi.fn();

    const res = (await handleChecksum(
      { path: '' },
      createReadStream,
      createHash,
      statSync,
    )) as Result<FsChecksumResult>;

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect((res.error as FsError).code).toBe('UNKNOWN');
    }
    expect(statSync).not.toHaveBeenCalled();
  });
});