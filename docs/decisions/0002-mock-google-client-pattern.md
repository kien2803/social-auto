# ADR-0002: Mock Google OAuth client qua interface chung

## Trạng thái
Đã chấp nhận

## Ngày
2026-08-28

## Bối cảnh

Flow OAuth cần test được trong CI mà không cần credential Google thật. Vài cách tiếp cận:

- **Gọi endpoint Google thật trong test** — cần credential ở CI, chậm, flaky, dễ rate-limit.
- **Mock `fetch` / `axios` ở tầng network** — test bị dính vào implementation của client thật; đổi SDK là vỡ test.
- **Inject mock ở ranh giới ứng dụng** — định nghĩa interface nhỏ, cả real và mock đều implement; route handler phụ thuộc interface.

Tương tác OAuth với Google rất gọn: 4 method. Interface ranh giới rẻ để duy trì.

## Quyết định

Định nghĩa `GoogleOAuthClient` là interface tối thiểu trong `apps/api/src/google/client.ts`:

```ts
interface GoogleOAuthClient {
  buildAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  getMyChannel(accessToken: string): Promise<ChannelInfo>;
}
```

Hai implementation:

- **`createRealGoogleClient(config)`** — dùng `googleapis`' `OAuth2` client.
- **`createMockGoogleClient(cfg?)`** — in-memory, trả về token có prefix `mock-access-`, hỗ trợ flag `failExchange` / `failRefresh` cho test đường âm.

Factory `createGoogleClient({ mode: 'real' | 'mock', real?, mock? })` chọn một theo env `USE_MOCK_GOOGLE`.

## Các phương án đã xét

### Mock ở tầng network (nock / msw)
- **Ưu**: Test đi qua code path thật, kể cả serialize.
- **Nhược**: Giòn — response Google và SDK `googleapis` đều có thể đổi. Test vỡ vì lý do ngoài code của mình.
- **Loại**: Interface đủ nhỏ, swap ra ngoài sạch hơn.

### Stub method SDK từng cái (sinon)
- **Ưu**: Ít abstraction phải giữ.
- **Nhược**: Test phải biết internals `googleapis`; không portable nếu sau đổi SDK.
- **Loại**: Test code nên bất kỳ HTTP client.

### Google thật ở CI (test user, recorded response)
- **Ưu**: Fidelity cao nhất.
- **Nhược**: Credential trong CI, chậm, OAuth consent screen đổi là vỡ, không test được "user revoke token".
- **Loại**: Chi phí >> giá trị cho tool single-user.

## Hệ quả

### Tích cực
- Test chạy millisecond, không phụ thuộc ngoài.
- Đường âm (token hết hạn, bị revoke, exchange fail) test được qua flag `failExchange` / `failRefresh`.
- Phase 1+ sẽ thêm method mới (vd `uploadVideo`) — thêm vào interface ép cả 2 implementation phải định nghĩa, không cho drift.
- Mock được dùng lại trong test harness qua `buildTestAppWithMock(mockCfg)` trong `apps/api/src/test-helpers.ts`.

### Tiêu cực
- **Mock có thể drift khỏi Google thật**. Giảm bằng cách giữ interface tối thiểu và đọc kỹ semantics `googleapis` khi thêm method.
- **Hai implementation phải duy trì**. Chấp nhận được — mock chỉ ~60 dòng.

### Trung tính
- `mode` của factory quyết định lúc startup theo `USE_MOCK_GOOGLE`. Không hỗ trợ switch runtime (không cần).

## Tham khảo

- Interface: [`apps/api/src/google/client.ts`](../../apps/api/src/google/client.ts)
- Mock: [`apps/api/src/google/mockClient.ts`](../../apps/api/src/google/mockClient.ts)
- Real: [`apps/api/src/google/realClient.ts`](../../apps/api/src/google/realClient.ts)
- Factory: [`apps/api/src/google/factory.ts`](../../apps/api/src/google/factory.ts)
- Test helper: [`apps/api/src/test-helpers.ts`](../../apps/api/src/test-helpers.ts)
- Áp dụng trong feature: [`docs/features/youtube-oauth.md`](../features/youtube-oauth.md)
