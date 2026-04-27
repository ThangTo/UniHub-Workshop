-- release-seat.lua
-- Atomic seat release: tăng counter ghế còn lại đúng 1 lần và xoá hold key.
-- Idempotent: nếu hold không tồn tại HOẶC requestId không khớp → không tăng.
--
-- KEYS[1] = seat:{workshopId}
-- KEYS[2] = hold:{workshopId}:{studentId}
-- ARGV[1] = requestId      -- để chắc chắn release đúng hold ban đầu
--
-- Trả:
--   {1, seatsLeft}    nếu release thành công
--   {0, "no_hold"}    nếu không có hold (đã release trước đó hoặc chưa từng allocate)
--   {0, "mismatch"}   nếu requestId không khớp (race protection)

local hold = redis.call('GET', KEYS[2])
if not hold then
  return {0, 'no_hold'}
end

if ARGV[1] ~= '' and hold ~= ARGV[1] then
  return {0, 'mismatch'}
end

redis.call('DEL', KEYS[2])

-- Chỉ INCR khi seat key tồn tại (tránh tạo key sai sau khi reconcile xoá).
local exists = redis.call('EXISTS', KEYS[1])
if exists == 1 then
  local left = redis.call('INCR', KEYS[1])
  return {1, left}
end

return {1, -1}
