-- allocate-seat.lua
-- Atomic seat allocation: trừ counter `seat:{workshopId}` đúng 1 lần
-- và đặt hold key `hold:{workshopId}:{studentId}` với TTL.
--
-- KEYS[1] = seat:{workshopId}        -- counter ghế còn lại
-- KEYS[2] = hold:{workshopId}:{studentId} -- key hold của SV này
-- ARGV[1] = requestId (uuid để correlate với DB INSERT)
-- ARGV[2] = ttlSeconds (15*60 hoặc 5*60 khi CB Open)
-- ARGV[3] = expectedInitial (capacity, dùng nếu key chưa tồn tại)
--
-- Trả:
--   {1, seatsLeft}            nếu allocate thành công
--   {0, "already_holding"}    nếu SV đã có hold (idempotent retry)
--   {0, "sold_out"}           nếu hết ghế

-- Nếu seat key chưa tồn tại, init = capacity.
local exists = redis.call('EXISTS', KEYS[1])
if exists == 0 then
  redis.call('SET', KEYS[1], tonumber(ARGV[3]))
end

-- Nếu SV này đã hold rồi → trả lại requestId cũ (idempotent).
local existingHold = redis.call('GET', KEYS[2])
if existingHold then
  return {0, 'already_holding', existingHold}
end

local left = tonumber(redis.call('GET', KEYS[1]))
if left == nil or left <= 0 then
  return {0, 'sold_out'}
end

-- Decrement seat counter, set hold.
redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))

return {1, left - 1}
