/**
 * DEV-ONLY placeholder commerce data, applied when SEED_PLACEHOLDER_PRICES=true.
 * Real prices / HSN / GST / stock / weights come from the business via the product-data CSV
 * (Open question Q2). HSN and GST values here are guesses and must be confirmed by Kritex's CA.
 */
export interface PlaceholderCommerce {
  /** Paise, GST-inclusive. */
  basePrice: number;
  hsnCode: string;
  /** Percent. */
  gstRate: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export const PLACEHOLDER_STOCK_PER_VARIANT = 25;

export function placeholderFor(
  categorySlug: string,
  subCategory: string,
): PlaceholderCommerce | null {
  switch (categorySlug) {
    case 'tactical-footwear':
      // HSN 6403: footwear with leather uppers. GST 5% at <= Rs 2,500 per pair.
      return {
        basePrice: 2_499_00,
        hsnCode: '6403',
        gstRate: '5',
        weightGrams: 1500,
        lengthCm: 33,
        widthCm: 22,
        heightCm: 13,
      };
    case 'combat-apparel': {
      // HSN 6109: knitted T-shirts; 6203: woven trousers/shorts/jackets. GST 5% at <= Rs 2,500.
      const knitted = /t-?shirt/i.test(subCategory);
      return {
        basePrice: 999_00,
        hsnCode: knitted ? '6109' : '6203',
        gstRate: '5',
        weightGrams: knitted ? 300 : 700,
        lengthCm: 30,
        widthCm: 25,
        heightCm: 5,
      };
    }
    case 'load-bearing':
      // HSN 4202: bags/rucksacks. GST 18%.
      return {
        basePrice: 1_999_00,
        hsnCode: '4202',
        gstRate: '18',
        weightGrams: 1200,
        lengthCm: 45,
        widthCm: 30,
        heightCm: 15,
      };
    default:
      return null;
  }
}
