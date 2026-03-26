#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import urllib.parse
from datetime import datetime

from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["*"])

LAST_TRAIN_HOUR = 23


@app.route("/api/timetable/<station_name>", methods=["GET"])
def get_timetable(station_name):
    try:
        station_name = urllib.parse.unquote(station_name)
        print(f"時刻表リクエスト: {station_name}")

        with open("jikoku.json", "r", encoding="utf-8") as file:
            data = json.load(file)

        now = datetime.now()
        current_hour = now.hour
        current_minute = now.minute
        current_time = f"{current_hour:02d}:{current_minute:02d}"

        day_type = "weekday" if now.weekday() < 5 else "weekend_holiday"
        timetable = data["timetable"][day_type]

        up_trains = process_trains(
            timetable["to_osaka_kyoto"], current_hour, current_minute
        )
        down_trains = process_trains(
            timetable["to_kobe_himeji"], current_hour, current_minute
        )

        mark_last_train(up_trains)
        mark_last_train(down_trains)

        return jsonify(
            {
                "status": "success",
                "station": data["station_name"],
                "line": data["line_name"],
                "current_time": current_time,
                "day_type": day_type,
                "directions": {
                    "up": {
                        "label": "のぼり",
                        "source": "to_osaka_kyoto",
                    },
                    "down": {
                        "label": "くだり",
                        "source": "to_kobe_himeji",
                    },
                },
                "up_trains": up_trains,
                "down_trains": down_trains,
            }
        )
    except Exception as error:
        print(f"エラー: {error}")
        import traceback

        traceback.print_exc()
        return jsonify({"status": "error", "error": str(error)}), 500


def process_trains(timetable_data, current_hour, current_minute):
    current_total = current_hour * 60 + current_minute
    trains = []

    for hour_str, departures in timetable_data.items():
        hour = int(hour_str)

        for minute, destination in departures:
            effective_minutes = hour * 60 + minute

            if hour < current_hour or (hour == current_hour and minute < current_minute):
                effective_minutes += 24 * 60

            minutes_until = effective_minutes - current_total
            if minutes_until < 0:
                continue

            trains.append(
                {
                    "time": f"{hour:02d}:{minute:02d}",
                    "destination": destination,
                    "type": get_train_type(destination),
                    "minutes_until": minutes_until,
                    "is_last_train": False,
                }
            )

    trains.sort(key=lambda train: train["minutes_until"])
    return trains


def mark_last_train(trains):
    late_trains = [train for train in trains if int(train["time"].split(":")[0]) >= LAST_TRAIN_HOUR]
    if not late_trains:
        return

    last_train = max(late_trains, key=lambda train: train["minutes_until"])
    last_train["is_last_train"] = True


def get_train_type(destination):
    rapid_destinations = {"大阪", "高槻", "京都", "野洲", "近江塩津", "長浜", "敦賀"}
    special_rapid_destinations = {"姫路", "網干", "米原", "長浜", "敦賀"}

    if destination in special_rapid_destinations:
        return "新快速"
    if destination in rapid_destinations:
        return "快速"
    return "普通"


@app.route("/test", methods=["GET"])
def test():
    return jsonify({"message": "APIは正常です", "time": datetime.now().isoformat()})


if __name__ == "__main__":
    print("時刻表APIを起動します...")
    print("http://localhost:5000/test でテストできます")
    app.run(host="0.0.0.0", port=5000, debug=True)
