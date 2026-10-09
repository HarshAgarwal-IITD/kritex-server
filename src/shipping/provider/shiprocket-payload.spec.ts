import {
  mapShiprocketStatus,
  nextShipmentStatus,
  parseShiprocketDate,
  parseShiprocketWebhook,
} from './shiprocket-payload';

describe('Shiprocket payload helpers', () => {
  it('parses IST timestamps in both Shiprocket formats', () => {
    expect(parseShiprocketDate('2023-05-19 11:59:16')?.toISOString()).toBe(
      '2023-05-19T06:29:16.000Z',
    );
    expect(parseShiprocketDate('23 05 2023 11:43:52')?.toISOString()).toBe(
      '2023-05-23T06:13:52.000Z',
    );
    expect(parseShiprocketDate('2023-05-19T06:29:16Z')?.toISOString()).toBe(
      '2023-05-19T06:29:16.000Z',
    );
    expect(parseShiprocketDate('yesterday')).toBeNull();
    expect(parseShiprocketDate(42)).toBeNull();
  });

  it.each([
    ['DELIVERED', 'DELIVERED'],
    ['Out For Delivery', 'OUT_FOR_DELIVERY'],
    ['IN TRANSIT', 'IN_TRANSIT'],
    ['REACHED AT DESTINATION HUB', 'IN_TRANSIT'],
    ['PICKED UP', 'SHIPPED'],
    ['PICKUP SCHEDULED', 'READY_TO_SHIP'],
    ['AWB ASSIGNED', 'READY_TO_SHIP'],
    ['RTO INITIATED', 'RTO'],
    ['RTO DELIVERED', 'RTO'],
    ['CANCELED', 'CANCELLED'],
    ['LOST', null],
    ['', null],
  ])('maps %s → %s', (text, status) => {
    expect(mapShiprocketStatus(text)).toBe(status);
  });

  it('only moves forward; RTO/CANCELLED override undelivered; terminal stays', () => {
    expect(nextShipmentStatus('READY_TO_SHIP', 'IN_TRANSIT')).toBe('IN_TRANSIT');
    expect(nextShipmentStatus('IN_TRANSIT', 'SHIPPED')).toBeNull();
    expect(nextShipmentStatus('IN_TRANSIT', 'IN_TRANSIT')).toBeNull();
    expect(nextShipmentStatus('IN_TRANSIT', 'RTO')).toBe('RTO');
    expect(nextShipmentStatus('DELIVERED', 'RTO')).toBeNull();
    expect(nextShipmentStatus('RTO', 'DELIVERED')).toBeNull();
    expect(nextShipmentStatus('SHIPPED', null)).toBeNull();
  });

  it('parses a webhook body (scans, courier, time) and rejects useless ones', () => {
    const update = parseShiprocketWebhook({
      awb: 19041424751540,
      courier_name: 'Delhivery Surface',
      current_status: 'IN TRANSIT',
      current_timestamp: '23 05 2023 11:43:52',
      sr_order_id: 348456385,
      scans: [
        {
          date: '2023-05-19 11:59:16',
          activity: 'Manifested',
          location: 'Chomu',
          'sr-status-label': 'MANIFEST GENERATED',
        },
        { date: 'bad', activity: 'x' },
      ],
    });
    expect(update).toEqual({
      awb: '19041424751540',
      providerOrderId: '348456385',
      courierName: 'Delhivery Surface',
      currentStatus: 'IN TRANSIT',
      at: new Date('2023-05-23T06:13:52.000Z'),
      scans: [
        {
          at: new Date('2023-05-19T06:29:16.000Z'),
          status: 'MANIFEST GENERATED',
          location: 'Chomu',
          description: 'Manifested',
        },
      ],
    });
    expect(parseShiprocketWebhook({ current_status: 'DELIVERED' })).toBeNull();
    expect(parseShiprocketWebhook({ awb: '1' })).toBeNull();
    expect(parseShiprocketWebhook('nope')).toBeNull();
  });
});
