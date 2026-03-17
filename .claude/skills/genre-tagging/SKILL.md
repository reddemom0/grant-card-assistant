# Genre Tagging Skill — Smart Filter Association Scoring

## Purpose
Score a grant program's association with smart filter genres. Currently supports "Building Bench of Talent" — more filters will be added as definitions are finalized.

## How to Use
When given a grant program (either a new program card or an existing program description), score it against each genre in the smart filter on a 0-3 scale.

## Scoring Scale
- 0 = No association
- 1 = Weak/indirect (mentioned but not the focus)
- 2 = Moderate (secondary activity of the program)
- 3 = Strong/primary (core activity of the program)

A single program can score on multiple genres. Some genres describe the activity (Hiring, Training), some describe who it targets (Student, Youth, Barriered Youth), some describe how funding works (Wage Subsidy, Remote Hire).

## Smart Filter: Building Bench of Talent
Category Group: Talent

Genres and definitions:
- Hiring: Funding supports hiring a new employee or intern. Tag when the grant requires creating a new position or placement.
- Wage subsidy: Program reimburses part of the employee's wages. Tag when funding is based on a percentage or fixed amount of salary.
- Student/Co-op Intern: Placement must be filled by a student or co-op participant enrolled in an educational program. Tag when eligibility requires the candidate to be an active student.
- Training: Funding supports skills development, courses, or workforce training. Tag when funding covers training costs, certification, or skill development.
- Apprenticeship: Funding supports apprenticeship training or apprentice positions in a skilled trade. Tag when the program targets registered apprentices or apprenticeship training.
- Youth Hire (<29 years old): The position must be filled by a young worker below the program's age limit. Tag when eligibility requires the candidate to be under a defined age threshold.
- Remote Hire: The funded position can be performed remotely or from outside the employer's location. Tag when the program explicitly allows remote or virtual placements.
- Barriered youth: Program targets youth who face barriers to employment. Tag when the program prioritizes or requires youth from under-represented or disadvantaged groups.

## Output Format
Return genre scores as structured data:
{
  "smart_filter": "Building Bench of Talent",
  "scores": {
    "hiring": 0-3,
    "wage_subsidy": 0-3,
    "student_coop": 0-3,
    "training": 0-3,
    "apprenticeship": 0-3,
    "youth_hire": 0-3,
    "remote_hire": 0-3,
    "barriered_youth": 0-3
  },
  "total_score": sum,
  "association_pct": total/24 as percentage
}

If the program covers a talent/hiring/training activity that genuinely doesn't fit any of the 8 genres, propose a new genre with name, definition, and why existing genres don't cover it. Only propose within the Talent category — ignore activities that belong to other smart filters.

## Adding New Smart Filters
As definitions are finalized for other smart filters (Adopt Software or AI, International Growth, etc.), they will be added as new sections below following the same format.
