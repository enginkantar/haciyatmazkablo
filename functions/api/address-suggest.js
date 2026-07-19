// GET /api/address-suggest?q=... — adres otomatik tamamlama.
// Anahtar gerekmez: OSM Nominatim. GOOGLE_MAPS_API_KEY tanımlanırsa Google
// Places'a geçer (hydrozidtr.com ile aynı sistem).

function jsonResp(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 3) return jsonResp({ suggestions: [] });

  try {
    const apiKey = env.GOOGLE_MAPS_API_KEY || env.MAPS_PLATFORM_API_KEY || '';
    const suggestions = apiKey
      ? await googleAddressSuggestions(q, apiKey)
      : await osmAddressSuggestions(q);
    return jsonResp({ suggestions });
  } catch (e) {
    console.error('[address-suggest] error:', e.message);
    return jsonResp({ suggestions: [], error: e.message });
  }
}

async function googleAddressSuggestions(q, apiKey) {
  const autocomplete = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  autocomplete.searchParams.set('input', q);
  autocomplete.searchParams.set('key', apiKey);
  autocomplete.searchParams.set('language', 'tr');
  autocomplete.searchParams.set('components', 'country:tr');
  autocomplete.searchParams.set('types', 'address');

  const autoRes = await fetch(autocomplete, { headers: { 'Accept': 'application/json' } });
  const autoData = await autoRes.json();
  const predictions = Array.isArray(autoData?.predictions) ? autoData.predictions.slice(0, 5) : [];
  if (!predictions.length) return [];

  const details = await Promise.all(predictions.map(async p => {
    const detailUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    detailUrl.searchParams.set('place_id', p.place_id);
    detailUrl.searchParams.set('fields', 'formatted_address,address_component');
    detailUrl.searchParams.set('language', 'tr');
    detailUrl.searchParams.set('key', apiKey);
    try {
      const detailRes = await fetch(detailUrl, { headers: { 'Accept': 'application/json' } });
      const detailData = await detailRes.json();
      const result = detailData?.result || {};
      const components = Array.isArray(result.address_components) ? result.address_components : [];
      const pick = (...types) => {
        const found = components.find(c => Array.isArray(c.types) && types.some(t => c.types.includes(t)));
        return found?.long_name || '';
      };
      return {
        label: result.formatted_address || p.description || q,
        city: pick('administrative_area_level_1', 'locality', 'postal_town'),
        district: pick('administrative_area_level_2', 'sublocality_level_1', 'sublocality', 'neighborhood'),
        address: result.formatted_address || p.description || q,
      };
    } catch {
      return { label: p.description || q, city: '', district: '', address: p.description || q };
    }
  }));
  return details.filter(s => s.label);
}

async function osmAddressSuggestions(q) {
  const upstream = new URL('https://nominatim.openstreetmap.org/search');
  upstream.searchParams.set('format', 'jsonv2');
  upstream.searchParams.set('addressdetails', '1');
  upstream.searchParams.set('countrycodes', 'tr');
  upstream.searchParams.set('dedupe', '1');
  upstream.searchParams.set('limit', '6');
  upstream.searchParams.set('q', q);

  const res = await fetch(upstream, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'HaciyatmazKablo/1.0 (address autocomplete)',
    },
  });
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map(item => {
    const a = item.address || {};
    const city = a.city || a.town || a.village || a.county || a.state || '';
    const district = a.city_district || a.suburb || a.borough || a.county || '';
    const street = [a.neighbourhood, a.road, a.house_number].filter(Boolean).join(' ').trim();
    const address = [street, district, city].filter(Boolean).join(', ');
    return { label: item.display_name || address || q, city, district, address };
  }).filter(s => s.label);
}
