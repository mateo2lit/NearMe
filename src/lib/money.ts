/**
 * Formatting prices for wherever the user actually is.
 *
 * Every price in the app was written as `$${amount}`, which is correct in the
 * one market NearMe launched in and wrong everywhere else — a London show
 * priced at £25 would have read "$25". The device already knows its locale and
 * `Intl.NumberFormat` already knows the symbols, so the only real decision is
 * which currency an event is priced in.
 */

/**
 * Best guess at the currency for a set of coordinates.
 *
 * Coarse on purpose: this covers the markets Ticketmaster and Meetup actually
 * serve, and falls back to the device's own locale currency rather than
 * assuming dollars. An event that carries an explicit currency from its source
 * should pass it in and skip this entirely.
 */
export function currencyForCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return deviceCurrency();
  }
  // Canada, by metro rather than by border. The US-Canada border weaves
  // through the Great Lakes and along the 45th parallel, so any rectangle wide
  // enough to hold Toronto also holds Detroit or Portland, Maine. Boxes around
  // the cities anyone is likely to open this app in are honest about being
  // approximate; everything else in North America falls through to USD, and
  // both currencies render with a dollar sign anyway.
  const CANADIAN_METROS: Array<[number, number, number, number]> = [
    [43.4, 44.4, -80.3, -78.8],   // Toronto / Hamilton
    [45.2, 45.8, -74.2, -73.2],   // Montreal
    [45.2, 45.6, -76.1, -75.3],   // Ottawa
    [48.9, 49.5, -123.5, -122.5], // Vancouver
    [50.7, 51.3, -114.5, -113.7], // Calgary
    [53.3, 53.8, -113.8, -113.2], // Edmonton
    [49.7, 50.1, -97.4, -96.9],   // Winnipeg
    [44.5, 44.8, -63.8, -63.4],   // Halifax
    [46.6, 47.0, -71.4, -71.0],   // Quebec City
  ];
  for (const [latMin, latMax, lngMin, lngMax] of CANADIAN_METROS) {
    if (lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax) return "CAD";
  }

  // Mexico, before the US box: the two overlap along the border.
  if (lat > 14 && lat < 30 && lng > -118 && lng < -86) return "MXN";
  // Continental US, plus the rest of Canada, which also uses a dollar sign.
  if (lat > 24 && lat < 72 && lng > -168 && lng < -52) return "USD";
  // British Isles
  if (lat > 49 && lat < 61 && lng > -11 && lng < 2) return "GBP";
  // Continental Europe (euro area, roughly)
  if (lat > 35 && lat < 71 && lng > -10 && lng < 31) return "EUR";
  // Australia / New Zealand
  if (lat > -44 && lat < -10 && lng > 112 && lng < 154) return "AUD";
  if (lat > -48 && lat < -34 && lng > 166 && lng < 179) return "NZD";
  // Japan
  if (lat > 30 && lat < 46 && lng > 129 && lng < 146) return "JPY";
  return deviceCurrency();
}

function deviceCurrency(): string {
  try {
    const resolved = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" })
      .resolvedOptions();
    return resolved.currency || "USD";
  } catch {
    return "USD";
  }
}

/** "$25", "£25", "¥2500" — no trailing ".00" on whole amounts. */
export function formatPrice(amount: number, currency = "USD"): string {
  try {
    // Whole amounts lose the ".00"; anything else keeps both decimal places,
    // so 25.5 reads as "$25.50" rather than "$25.5".
    const digits = Number.isInteger(amount) ? 0 : 2;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `$${Math.round(amount)}`;
  }
}

/** "From $25" / "$25–$80" / "Free" / "Tickets". */
export function priceLabel(event: {
  is_free?: boolean;
  price_min?: number | null;
  price_max?: number | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  if (event.is_free) return "Free";
  const currency = currencyForCoords(event.lat ?? null, event.lng ?? null);
  const { price_min: min, price_max: max } = event;
  if (min != null && max != null && max > min) {
    return `${formatPrice(min, currency)}–${formatPrice(max, currency)}`;
  }
  if (min != null) return `${formatPrice(min, currency)}+`;
  return "Tickets";
}
