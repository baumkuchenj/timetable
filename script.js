let timetableData = null;
let refreshTimer = null;
let clockTimer = null;

const REFRESH_INTERVAL_MS = 60 * 1000;
const SERVICE_DAY_BORDER_HOUR = 3;
const FIRST_TRAIN_NOTICE_MINUTES = 60;
const DIRECTION_LABELS = {
    up: "のぼり",
    down: "くだり",
};

function updateCurrentTime() {
    const now = new Date();
    document.getElementById("currentTime").textContent = now.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function addDays(date, days) {
    const value = new Date(date);
    value.setDate(value.getDate() + days);
    return value;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
    const firstDay = new Date(year, monthIndex, 1);
    const diff = (7 + weekday - firstDay.getDay()) % 7;
    return 1 + diff + (nth - 1) * 7;
}

function calcVernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function calcAutumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getJapaneseHolidaySet(year) {
    const holidays = new Set();
    const addHoliday = (month, day) => {
        holidays.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    };

    addHoliday(1, 1);
    addHoliday(1, nthWeekdayOfMonth(year, 0, 1, 2));
    addHoliday(2, 11);
    addHoliday(2, 23);
    addHoliday(3, calcVernalEquinoxDay(year));
    addHoliday(4, 29);
    addHoliday(5, 3);
    addHoliday(5, 4);
    addHoliday(5, 5);
    addHoliday(7, nthWeekdayOfMonth(year, 6, 1, 3));
    addHoliday(8, 11);
    addHoliday(9, nthWeekdayOfMonth(year, 8, 1, 3));
    addHoliday(9, calcAutumnalEquinoxDay(year));
    addHoliday(10, nthWeekdayOfMonth(year, 9, 1, 2));
    addHoliday(11, 3);
    addHoliday(11, 23);

    const sorted = [...holidays].sort();

    sorted.forEach((key) => {
        const holidayDate = new Date(`${key}T00:00:00`);
        if (holidayDate.getDay() !== 0) {
            return;
        }

        const substitute = new Date(holidayDate);
        do {
            substitute.setDate(substitute.getDate() + 1);
        } while (holidays.has(dateKey(substitute)));

        holidays.add(dateKey(substitute));
    });

    for (let month = 0; month < 12; month += 1) {
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 2; day < daysInMonth; day += 1) {
            const current = new Date(year, month, day);
            const previous = addDays(current, -1);
            const next = addDays(current, 1);
            const currentKey = dateKey(current);

            if (
                current.getDay() !== 0 &&
                holidays.has(dateKey(previous)) &&
                holidays.has(dateKey(next)) &&
                !holidays.has(currentKey)
            ) {
                holidays.add(currentKey);
            }
        }
    }

    return holidays;
}

function isJapaneseHoliday(date) {
    return getJapaneseHolidaySet(date.getFullYear()).has(dateKey(date));
}

function getDayType(date) {
    const day = date.getDay();
    return day === 0 || day === 6 || isJapaneseHoliday(date) ? "weekend_holiday" : "weekday";
}

function getServiceDate(now) {
    return now.getHours() < SERVICE_DAY_BORDER_HOUR ? addDays(startOfDay(now), -1) : startOfDay(now);
}

function getMinutesUntil(date) {
    return Math.floor((date.getTime() - Date.now()) / 60000);
}

function formatMinutesUntil(minutesUntil) {
    return `${Math.max(0, minutesUntil)}分後`;
}

function buildTrainInstances(rawTimetable, serviceDate) {
    const trains = [];

    Object.entries(rawTimetable || {}).forEach(([hourText, departures]) => {
        const hour = Number(hourText);

        departures.forEach(([minute, destination]) => {
            const departure = new Date(serviceDate);

            if (hour < SERVICE_DAY_BORDER_HOUR) {
                departure.setDate(departure.getDate() + 1);
            }

            departure.setHours(hour, minute, 0, 0);

            trains.push({
                departure,
                destination,
            });
        });
    });

    return trains.sort((a, b) => a.departure - b.departure);
}

function getDirectionState(todayTimetable, nextDayTimetable, serviceDate, nextServiceDate) {
    const now = new Date();
    const todayTrains = buildTrainInstances(todayTimetable, serviceDate);
    const remainingToday = todayTrains.filter((train) => train.departure >= now);
    const lastTrain = todayTrains.at(-1) || null;

    if (remainingToday.length > 0) {
        const nextTrain = remainingToday[0];
        const isLastTrain = lastTrain && nextTrain.departure.getTime() === lastTrain.departure.getTime();

        return {
            kind: isLastTrain ? "last" : "normal",
            destination: nextTrain.destination,
            minutesUntil: getMinutesUntil(nextTrain.departure),
        };
    }

    const nextDayTrains = buildTrainInstances(nextDayTimetable, nextServiceDate);
    const firstTrain = nextDayTrains[0] || null;

    if (firstTrain) {
        const minutesUntilFirst = getMinutesUntil(firstTrain.departure);

        if (minutesUntilFirst >= 0 && minutesUntilFirst <= FIRST_TRAIN_NOTICE_MINUTES) {
            return {
                kind: "first",
                destination: firstTrain.destination,
                minutesUntil: minutesUntilFirst,
            };
        }
    }

    return {
        kind: "none",
        destination: "",
        minutesUntil: null,
    };
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatDirectionText(label, state) {
    if (state.kind === "none") {
        return `<span class="direction">${label}</span>:本日は電車ありません`;
    }

    const suffix = state.kind === "last" ? "（終電）" : state.kind === "first" ? "（始発）" : "";
    return `<span class="direction">${label}</span>:${formatMinutesUntil(state.minutesUntil)} ${escapeHtml(state.destination)}行き${suffix}`;
}

function renderNextTrainText() {
    const nextTrainText = document.getElementById("nextTrainText");
    const loadingText = document.getElementById("loadingText");

    if (!timetableData?.timetable) {
        return;
    }

    const now = new Date();
    const serviceDate = getServiceDate(now);
    const nextServiceDate = addDays(serviceDate, 1);
    const todayDayType = getDayType(serviceDate);
    const nextDayType = getDayType(nextServiceDate);
    const todayTimetable = timetableData.timetable[todayDayType];
    const nextDayTimetable = timetableData.timetable[nextDayType];

    if (!todayTimetable) {
        nextTrainText.innerHTML = '<span class="muted">時刻表がありません</span>';
    } else {
        const upState = getDirectionState(
            todayTimetable.to_osaka_kyoto,
            nextDayTimetable?.to_osaka_kyoto,
            serviceDate,
            nextServiceDate
        );
        const downState = getDirectionState(
            todayTimetable.to_kobe_himeji,
            nextDayTimetable?.to_kobe_himeji,
            serviceDate,
            nextServiceDate
        );

        nextTrainText.innerHTML = `${formatDirectionText(DIRECTION_LABELS.up, upState)}<br>${formatDirectionText(DIRECTION_LABELS.down, downState)}`;
    }

    loadingText.classList.add("hidden");
    nextTrainText.classList.remove("hidden");
}

function setErrorState(show, message = "時刻表の読み込みに失敗しました") {
    const errorText = document.getElementById("errorText");
    errorText.textContent = message;
    errorText.classList.toggle("hidden", !show);
}

async function displayTimetable() {
    try {
        const response = await fetch("./jikoku.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        timetableData = await response.json();
        const stationName = timetableData.station_name ? `「${timetableData.station_name}」駅` : "--駅";
        document.getElementById("stationName").textContent = stationName;

        setErrorState(false);
        renderNextTrainText();
    } catch (error) {
        console.error("時刻表読み込みエラー:", error);
        setErrorState(true);
    }
}

function updateLiveDisplay() {
    updateCurrentTime();

    if (timetableData) {
        renderNextTrainText();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    updateCurrentTime();
    displayTimetable();

    clockTimer = setInterval(updateLiveDisplay, 1000);
    refreshTimer = setInterval(displayTimetable, REFRESH_INTERVAL_MS);
});
