const WEATHER_FIELDS = [
    'nebulositeCode', 'nebulositeLibelleCourt', 'nebulositeLibelleLong', 'temperature',
    'forceVent', 'directionVent', 'etatPiste', 'datePrevision'
];

/** Keep the PMU weather payload predictable and reject malformed values. */
export function normalizeWeather(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const weather = {};
    const cloud = value.nebulositeCode ?? value.codeNebulosite ?? value.nebulosite;
    if (typeof cloud === 'string' && cloud.trim()) weather.nebulositeCode = cloud.trim();
    else if (typeof cloud === 'number' && Number.isFinite(cloud)) weather.nebulositeCode = String(cloud);
    for (const key of ['nebulositeLibelleCourt', 'nebulositeLibelleLong', 'directionVent']) {
        if (typeof value[key] === 'string' && value[key].trim()) weather[key] = value[key].trim();
    }

    const temperature = value.temperature ?? value.temperatureCelsius;
    if (temperature !== null && temperature !== undefined && temperature !== '') {
        const parsed = typeof temperature === 'number' ? temperature : Number(String(temperature).trim().replace(',', '.').replace(/\s*°\s*C?$/i, '').trim());
        if (Number.isFinite(parsed) && parsed >= -100 && parsed <= 70) weather.temperature = parsed;
    }

    const wind = value.forceVent;
    if (wind !== null && wind !== undefined && wind !== '') {
        const parsed = typeof wind === 'number' ? wind : Number(wind);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 400) weather.forceVent = parsed;
    }

    const track = value.etatPiste ?? value.terrain;
    if (typeof track === 'string' && track.trim()) weather.etatPiste = track.trim();
    const forecastDate = value.datePrevision;
    const parsedForecastDate = typeof forecastDate === 'number'
        ? new Date(forecastDate)
        : typeof forecastDate === 'string' ? new Date(forecastDate) : null;
    if (parsedForecastDate && Number.isFinite(parsedForecastDate.getTime())) weather.datePrevision = parsedForecastDate.toISOString();
    if (typeof value.capturedAt === 'string' && Number.isFinite(Date.parse(value.capturedAt))) weather.capturedAt = new Date(value.capturedAt).toISOString();
    if (WEATHER_FIELDS.some(field => weather[field] !== undefined)) return weather;
    return null;
}

export function weatherLabel(value) {
    const weather = normalizeWeather(value);
    if (!weather) return 'Météo indisponible';
    const parts = [];
    const cloud = weather.nebulositeLibelleCourt || weather.nebulositeCode;
    if (cloud) parts.push(cloud.replaceAll('_', ' ').toLocaleLowerCase('fr-FR'));
    if (weather.temperature !== undefined) parts.push(`${weather.temperature}°C`);
    if (weather.etatPiste) parts.push(`Piste : ${weather.etatPiste}`);
    if (weather.forceVent !== undefined) parts.push(`Vent ${weather.forceVent}${weather.directionVent ? ` ${weather.directionVent}` : ''}`);
    return parts.length ? parts.join(' · ') : 'Météo indisponible';
}

export function mergeWeather(previous, incoming, capturedAt = new Date().toISOString()) {
    const oldWeather = normalizeWeather(previous);
    const newWeather = normalizeWeather(incoming);
    if (!newWeather) return oldWeather;
    if (!oldWeather) return { ...newWeather, capturedAt };
    if (oldWeather.datePrevision && newWeather.datePrevision
        && oldWeather.datePrevision !== newWeather.datePrevision) {
        return {
            ...(oldWeather.etatPiste ? { etatPiste: oldWeather.etatPiste } : {}),
            ...newWeather,
            capturedAt
        };
    }
    return { ...oldWeather, ...newWeather, capturedAt };
}
