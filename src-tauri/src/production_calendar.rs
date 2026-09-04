use chrono::{Datelike, NaiveDate, Weekday};
use kuchikiki::traits::TendrilSink;
use serde::Serialize;
use std::time::Duration;

const CONSULTANT_BASE_URL: &str = "https://www.consultant.ru/law/ref/calendar/proizvodstvennye";
const MAX_CALENDAR_PAGE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CalendarDayType {
    PublicHoliday,
    AdditionalDayOff,
    ShortenedWorkday,
    WorkingWeekend,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    date: String,
    r#type: CalendarDayType,
    #[serde(skip_serializing_if = "Option::is_none")]
    holiday_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionCalendarYear {
    year: i32,
    days: Vec<CalendarDay>,
    source: &'static str,
    is_project: bool,
}

fn public_holiday_name(month: u32, day: u32) -> Option<&'static str> {
    match (month, day) {
        (1, 1..=6) | (1, 8) => Some("Новогодние каникулы"),
        (1, 7) => Some("Рождество Христово"),
        (2, 23) => Some("День защитника Отечества"),
        (3, 8) => Some("Международный женский день"),
        (5, 1) => Some("Праздник Весны и Труда"),
        (5, 9) => Some("День Победы"),
        (6, 12) => Some("День России"),
        (11, 4) => Some("День народного единства"),
        _ => None,
    }
}

fn classify_day(date: NaiveDate, classes: &str) -> Option<CalendarDay> {
    let has_class = |needle: &str| {
        classes
            .split_ascii_whitespace()
            .any(|class| class == needle)
    };
    let statutory_holiday = public_holiday_name(date.month(), date.day());
    let is_weekend = matches!(date.weekday(), Weekday::Sat | Weekday::Sun);

    let day_type = if has_class("holiday") {
        if statutory_holiday.is_some() {
            CalendarDayType::PublicHoliday
        } else {
            CalendarDayType::AdditionalDayOff
        }
    } else if has_class("preholiday") {
        if is_weekend {
            CalendarDayType::WorkingWeekend
        } else {
            CalendarDayType::ShortenedWorkday
        }
    } else if has_class("weekend") {
        if is_weekend {
            return None;
        }
        CalendarDayType::AdditionalDayOff
    } else if is_weekend {
        CalendarDayType::WorkingWeekend
    } else {
        return None;
    };

    Some(CalendarDay {
        date: date.format("%Y-%m-%d").to_string(),
        r#type: day_type,
        holiday_name: statutory_holiday.map(str::to_string),
    })
}

fn parse_calendar_html(year: i32, html: &str) -> Result<ProductionCalendarYear, String> {
    let document = kuchikiki::parse_html().one(html).document_node;
    let heading = document
        .select_first("h1")
        .map_err(|_| "На странице КонсультантПлюс не найден заголовок календаря".to_string())?
        .text_contents();
    if !heading.contains(&year.to_string()) {
        return Err("Страница КонсультантПлюс содержит календарь другого года".to_string());
    }

    let tables = document
        .select("table.cal")
        .map_err(|_| "Не удалось прочитать таблицы календаря КонсультантПлюс".to_string())?
        .collect::<Vec<_>>();
    if tables.len() != 12 {
        return Err(format!(
            "Ожидалось 12 таблиц календаря КонсультантПлюс, найдено {}",
            tables.len()
        ));
    }

    let expected_days = if NaiveDate::from_ymd_opt(year, 2, 29).is_some() {
        366
    } else {
        365
    };
    let mut parsed_days = 0usize;
    let mut special_days = Vec::new();

    for (month_index, table) in tables.iter().enumerate() {
        let month = month_index as u32 + 1;
        let cells = table
            .as_node()
            .select("td")
            .map_err(|_| "Не удалось прочитать дни календаря КонсультантПлюс".to_string())?;

        for cell in cells {
            let attributes = cell.attributes.borrow();
            let classes = attributes.get("class").unwrap_or_default();
            if classes
                .split_ascii_whitespace()
                .any(|class| class == "inactively")
            {
                continue;
            }

            let text = cell.text_contents();
            let day_digits = text
                .trim_start()
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>();
            let Some(day) = day_digits.parse::<u32>().ok() else {
                continue;
            };
            let Some(date) = NaiveDate::from_ymd_opt(year, month, day) else {
                return Err("Страница КонсультантПлюс содержит некорректную дату".to_string());
            };
            parsed_days += 1;
            if let Some(special_day) = classify_day(date, classes) {
                special_days.push(special_day);
            }
        }
    }

    if parsed_days != expected_days {
        return Err(format!(
            "Календарь КонсультантПлюс неполный: ожидалось {expected_days} дней, найдено {parsed_days}"
        ));
    }

    let page_text = document.text_contents().to_lowercase();
    let is_project = heading.to_lowercase().contains("проект")
        || page_text.contains("не утвержден правительством");

    Ok(ProductionCalendarYear {
        year,
        days: special_days,
        source: "consultant.ru",
        is_project,
    })
}

#[tauri::command]
pub async fn load_consultant_production_calendar(
    year: i32,
) -> Result<ProductionCalendarYear, String> {
    if !(1993..=2100).contains(&year) {
        return Err("Недопустимый год производственного календаря".to_string());
    }

    let url = format!("{CONSULTANT_BASE_URL}/{year}/");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("sadmoneyapp production calendar loader")
        .build()
        .map_err(|_| "Не удалось подготовить загрузку производственного календаря".to_string())?;
    let response = client.get(url).send().await.map_err(|_| {
        "Не удалось загрузить производственный календарь КонсультантПлюс".to_string()
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "КонсультантПлюс не вернул производственный календарь за {year} год"
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CALENDAR_PAGE_BYTES)
    {
        return Err("Страница производственного календаря слишком большая".to_string());
    }
    let html_bytes = response.bytes().await.map_err(|_| {
        "Не удалось прочитать производственный календарь КонсультантПлюс".to_string()
    })?;
    if html_bytes.len() as u64 > MAX_CALENDAR_PAGE_BYTES {
        return Err("Страница производственного календаря слишком большая".to_string());
    }
    let html = std::str::from_utf8(&html_bytes)
        .map_err(|_| "Производственный календарь имеет неподдерживаемую кодировку".to_string())?;

    parse_calendar_html(year, html)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn calendar_fixture(year: i32) -> String {
        let mut html =
            format!("<html><body><h1>Производственный календарь на {year} год (проект)</h1>");
        for month in 1..=12 {
            html.push_str("<table class=\"cal\"><tr>");
            let mut day = 1;
            while let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
                let classes = match (month, day) {
                    (1, 1..=8) => "holiday weekend",
                    (2, 20) => "preholiday",
                    (2, 22) => "holiday weekend",
                    _ if matches!(date.weekday(), Weekday::Sat | Weekday::Sun) => "weekend",
                    _ => "",
                };
                let marker = if classes == "preholiday" {
                    "<a href=\"#shortday\">*</a>"
                } else {
                    ""
                };
                html.push_str(&format!("<td class=\"{classes}\">{day}{marker}</td>"));
                day += 1;
            }
            html.push_str("</tr></table>");
        }
        html.push_str("</body></html>");
        html
    }

    #[test]
    fn parses_project_calendar_and_distinguishes_special_days() {
        let calendar = parse_calendar_html(2027, &calendar_fixture(2027)).unwrap();

        assert!(calendar.is_project);
        assert!(calendar.days.iter().any(|day| {
            day.date == "2027-01-04" && day.r#type == CalendarDayType::PublicHoliday
        }));
        assert!(calendar.days.iter().any(|day| {
            day.date == "2027-02-20" && day.r#type == CalendarDayType::WorkingWeekend
        }));
        assert!(calendar.days.iter().any(|day| {
            day.date == "2027-02-22" && day.r#type == CalendarDayType::AdditionalDayOff
        }));
        let serialized = serde_json::to_value(&calendar).unwrap();
        assert_eq!(serialized["source"], "consultant.ru");
        assert_eq!(serialized["isProject"], true);
        assert!(serialized["days"].as_array().unwrap().iter().any(|day| {
            day["date"] == "2027-01-04"
                && day["type"] == "public_holiday"
                && day["holidayName"] == "Новогодние каникулы"
        }));
    }

    #[test]
    fn rejects_incomplete_calendar_page() {
        let error = parse_calendar_html(
            2027,
            "<h1>Производственный календарь на 2027 год</h1><table class=\"cal\"></table>",
        )
        .unwrap_err();

        assert!(error.contains("12 таблиц"));
    }

    #[test]
    #[ignore = "live smoke test for the external calendar page"]
    fn parses_live_consultant_calendar() {
        let calendar =
            tauri::async_runtime::block_on(load_consultant_production_calendar(2027)).unwrap();

        assert_eq!(calendar.year, 2027);
        assert!(calendar.days.iter().any(|day| day.date == "2027-01-08"));
    }
}
