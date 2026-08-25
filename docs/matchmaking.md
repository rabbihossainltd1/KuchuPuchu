# KuchuPuchu — Matchmaking Specification

## Goal
Recommend players who are genuinely compatible rather than simply nearby.

## Inputs
- preferred modes
- rank
- server
- language
- availability
- play style
- mic preference
- activity
- coarse location
- user preferences
- safety eligibility
- reputation signals

## Ranking
Use configurable weighted scoring. Start with deterministic rules before adding ML.

Example:
- mode compatibility: high
- server compatibility: high
- availability: high
- rank similarity: medium-high
- language: medium
- play style: medium
- activity: medium
- coarse proximity: low-medium
- reputation: low-medium

Weights must be configurable and tested.

## Exclusions
Never recommend:
- blocked users
- users who blocked the requester
- suspended/banned users
- incompatible privacy states
- users outside safety eligibility
- already-dismissed users within cooldown

## Explainability
Show simple reasons:
- Same mode
- Similar rank
- Active now
- Same language
- Similar play style

## Safety
Do not reveal exact address or live location through recommendations.
