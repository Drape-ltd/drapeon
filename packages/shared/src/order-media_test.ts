import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { orderMediaStoragePath } from './order-media.ts'

Deno.test('normalises private order-media paths and legacy delivery URLs', () => {
  assertEquals(orderMediaStoragePath('brief/customer/photo.jpg'), 'brief/customer/photo.jpg')
  assertEquals(
    orderMediaStoragePath('https://project.supabase.co/storage/v1/object/public/order-photos/brief/customer/photo.jpg'),
    'brief/customer/photo.jpg',
  )
  assertEquals(
    orderMediaStoragePath('https://project.supabase.co/storage/v1/object/sign/order-photos/progress/order/photo.jpg?token=value'),
    'progress/order/photo.jpg',
  )
})

Deno.test('rejects external, malformed and non-order-media values', () => {
  assertEquals(orderMediaStoragePath('https://example.com/photo.jpg'), null)
  assertEquals(orderMediaStoragePath('https://project.supabase.co/storage/v1/object/public/avatars/customer/photo.jpg'), null)
  assertEquals(orderMediaStoragePath('../brief/customer/photo.jpg'), null)
  assertEquals(orderMediaStoragePath(''), null)
})
