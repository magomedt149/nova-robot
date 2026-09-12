#!/usr/bin/env python3
import json, sys, statistics

# Proxy score only. This is NOT YouTube's internal algorithm.
# Input JSON fields:
# chose_to_view, avg_percent_viewed, avg_view_duration, video_duration,
# subscribers_gained, views, likes, comments, shares,
# median_chose_to_view, median_avg_percent_viewed,
# median_subscriber_velocity, median_engagement_rate

def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))

def ratio(v, baseline):
    if not baseline or baseline <= 0:
        return 1.0
    return v / baseline

def score(data):
    ctv = float(data.get("chose_to_view", 0))
    apv = float(data.get("avg_percent_viewed", 0))
    avd = float(data.get("avg_view_duration", 0))
    dur = max(float(data.get("video_duration", 1)), 1)
    views = max(float(data.get("views", 0)), 1)
    subs = float(data.get("subscribers_gained", 0))
    likes = float(data.get("likes", 0))
    comments = float(data.get("comments", 0))
    shares = float(data.get("shares", 0))

    m_ctv = float(data.get("median_chose_to_view", ctv or 1))
    m_apv = float(data.get("median_avg_percent_viewed", apv or 1))
    m_sv = float(data.get("median_subscriber_velocity", 0.1))
    m_er = float(data.get("median_engagement_rate", 0.01))

    subscriber_velocity = subs / views * 1000
    engagement_rate = (likes + comments * 2 + shares * 3) / views
    duration_ratio = avd / dur

    s_ctv = 30 * clamp(ratio(ctv, m_ctv) / 1.5)
    s_apv = 25 * clamp(ratio(apv, m_apv) / 1.5)
    s_dur = 15 * clamp(duration_ratio / 1.0)
    s_sub = 15 * clamp(ratio(subscriber_velocity, m_sv) / 2.0)
    s_eng = 10 * clamp(ratio(engagement_rate, m_er) / 2.0)
    s_loop = 5 * clamp((apv - 100) / 40) if apv > 100 else 0

    total = round(s_ctv + s_apv + s_dur + s_sub + s_eng + s_loop, 1)

    if total >= 85:
        decision = "SCALE_NOW"
    elif total >= 75:
        decision = "KEEP_AND_TEST_NEW_HOOK"
    elif total >= 60:
        decision = "REWORK"
    else:
        decision = "PAUSE_FORMAT"

    return {
        "performance_score": total,
        "subscriber_velocity_per_1000_views": round(subscriber_velocity, 3),
        "engagement_rate": round(engagement_rate, 4),
        "decision": decision,
        "components": {
            "chose_to_view": round(s_ctv, 1),
            "avg_percent_viewed": round(s_apv, 1),
            "duration_ratio": round(s_dur, 1),
            "subscriber_velocity": round(s_sub, 1),
            "engagement": round(s_eng, 1),
            "loop_bonus": round(s_loop, 1),
        },
        "note": "Proxy model for channel decisions; not YouTube's internal ranking algorithm."
    }

if __name__ == "__main__":
    data = json.load(sys.stdin)
    print(json.dumps(score(data), ensure_ascii=False, indent=2))
