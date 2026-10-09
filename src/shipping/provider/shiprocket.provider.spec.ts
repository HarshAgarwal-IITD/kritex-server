import { FakeShippingProvider } from './fake-shipping.provider';
import { ShiprocketProvider } from './shiprocket.provider';
import { ShippingProviderError } from './shipping-provider';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const input = {
  channelOrderId: 'KTX-100001',
  orderDate: new Date('2026-10-09T08:30:00Z'),
  pickupLocation: 'Primary',
  billing: {
    name: 'Asha Rao',
    phone: '+919876543210',
    email: 'a@b.co',
    line1: '12 MG Road',
    line2: null,
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
  },
  shipping: {
    name: 'Asha Rao',
    phone: '+919876543210',
    email: 'a@b.co',
    line1: '12 MG Road',
    line2: null,
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
  },
  items: [
    {
      name: 'Shirt (M)',
      sku: 'KTX-CS-M',
      units: 2,
      unitPrice: 129900,
      discount: 0,
      hsn: '6205',
      taxRate: 5,
    },
  ],
  shippingCharges: 9900,
  total: 269700,
  weightGrams: 1200,
  lengthCm: 30,
  widthCm: 25,
  heightCm: 5,
};

describe('ShiprocketProvider', () => {
  const config = { email: 'api@kritex.in', password: 'pw', baseUrl: 'https://sr.test/v1/external' };

  it('logs in once, caches the token, and refreshes it on a 401', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json({ token: 't1' }))
      .mockResolvedValueOnce(json({ order_id: 11, shipment_id: 22 }))
      .mockResolvedValueOnce(json({ message: 'expired' }, 401))
      .mockResolvedValueOnce(json({ token: 't2' }))
      .mockResolvedValueOnce(
        json({
          awb_assign_status: 1,
          response: {
            data: { awb_code: 'AWB1', courier_name: 'Delhivery', courier_company_id: 7 },
          },
        }),
      );
    const sr = new ShiprocketProvider(config, fetchMock as typeof fetch);

    await expect(sr.createOrder(input)).resolves.toEqual({
      providerOrderId: '11',
      providerShipmentId: '22',
    });
    const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe('https://sr.test/v1/external/auth/login');
    expect(JSON.parse(loginInit.body as string)).toEqual({
      email: 'api@kritex.in',
      password: 'pw',
    });
    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createUrl).toBe('https://sr.test/v1/external/orders/create/adhoc');
    expect((createInit.headers as Record<string, string>).Authorization).toBe('Bearer t1');
    expect(JSON.parse(createInit.body as string)).toEqual(
      expect.objectContaining({
        order_id: 'KTX-100001',
        order_date: '2026-10-09 14:00',
        billing_customer_name: 'Asha',
        billing_last_name: 'Rao',
        billing_phone: '9876543210',
        shipping_is_billing: true,
        payment_method: 'Prepaid',
        sub_total: 2598,
        shipping_charges: 99,
        weight: 1.2,
        order_items: [
          {
            name: 'Shirt (M)',
            sku: 'KTX-CS-M',
            units: 2,
            selling_price: 1299,
            discount: 0,
            tax: 5,
            hsn: '6205',
          },
        ],
      }),
    );

    await expect(sr.assignAwb('22', 7)).resolves.toEqual({
      awb: 'AWB1',
      courierName: 'Delhivery',
      courierId: 7,
    });
    expect((fetchMock.mock.calls[4][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer t2' }),
    );
    expect(JSON.parse((fetchMock.mock.calls[4][1] as RequestInit).body as string)).toEqual({
      shipment_id: 22,
      courier_id: 7,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('turns API refusals into ShippingProviderError (without credentials)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(json({ awb_assign_status: 0, message: 'No courier serviceable' }))
      .mockResolvedValueOnce(json({ message: 'Invalid data' }, 422))
      .mockResolvedValueOnce(json({ pickup_status: 0 }));
    const sr = new ShiprocketProvider(config, fetchMock as typeof fetch);
    await expect(sr.assignAwb('22')).rejects.toBeInstanceOf(ShippingProviderError);
    const err = (await sr.generateLabel('22').catch((e: unknown) => e)) as ShippingProviderError;
    expect(err.message).toContain('Invalid data');
    expect(JSON.stringify(err)).not.toContain('pw');
    await expect(sr.requestPickup('22')).rejects.toThrow(/pickup/);

    const badLogin = new ShiprocketProvider(
      config,
      jest.fn().mockResolvedValue(json({ message: 'bad creds' }, 403)) as typeof fetch,
    );
    await expect(badLogin.generateLabel('1')).rejects.toThrow(/login failed/);
  });

  it('pulls tracking', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json({ token: 't' }))
      .mockResolvedValueOnce(
        json({
          tracking_data: {
            shipment_track: [
              { current_status: 'Delivered', courier_name: 'Delhivery', sr_order_id: 5 },
            ],
            shipment_track_activities: [
              {
                date: '2026-10-11 15:20:00',
                activity: 'Delivered',
                location: 'Mumbai',
                'sr-status-label': 'DELIVERED',
              },
            ],
          },
        }),
      );
    const sr = new ShiprocketProvider(config, fetchMock as typeof fetch);
    const t = await sr.track('AWB1');
    expect(t).toEqual(
      expect.objectContaining({
        currentStatus: 'Delivered',
        providerOrderId: '5',
        at: new Date('2026-10-11T09:50:00Z'),
      }),
    );
    expect(sr.trackingUrl('AWB1')).toBe('https://shiprocket.co/tracking/AWB1');
  });
});

describe('FakeShippingProvider', () => {
  it('is deterministic', async () => {
    const fake = new FakeShippingProvider();
    const a = await fake.createOrder(input);
    const b = await fake.createOrder(input);
    expect(a).toEqual(b);
    expect(a.providerShipmentId).toMatch(/^fake_ship_\d{9}$/);
    const awb = await fake.assignAwb(a.providerShipmentId);
    expect(awb).toEqual({
      awb: expect.stringMatching(/^FAKE\d{10}$/),
      courierName: 'Fake Courier',
      courierId: 1,
    });
    expect((await fake.assignAwb(a.providerShipmentId)).awb).toBe(awb.awb);
  });
});
