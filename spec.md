# Politics battle
This project is a politics simulation battleground. It consists of a politician, described by a user (lawyer, billionare, leftist, rightist, working man, etc...) which is trying to win over the populus.

## Populus
The electorate itself consists of bunch of small swarm subagents (with a dumb and cheap llm-model). Some live in the big cities, some in rural areas and so on. They each have their own opinions consisting of problems they face day to day, beliefs and so on. They have an election comming up and must decide their best candidate. Also as the attendance is not mandetory some decide not to vote entierly.
They are influenced by politicians campaigns, decisions, sayings, current and past events, social and TV media.

## Politician
Politician itself can be hand designed by the user. They can be member of certain party with certain beliefs (conservatives, labour, greens, communists, neocons and so on). They also can come from a certain class (upper middle, working class, billionare and so on). He can comment on certain events, make election promises, promise reforms, run social media campaigns (even engaige on corruption tho with a risk of it airing out).

## Opposition
Against the user there also should be running 3 other candidates from different parties, each with their own beliefs and drive for power.

## Events
Another ai (smarter one) can run random events (like inform certain populus about some stuff). For example: a natural catastrophe, economy crash, expose about the party or party member, pandemic lockdown (very rare event), increase in immigration, popular accident disaster, change in prices.

## Start screen
At the start user can pick the size of the country (which determines the amount of the swarm agents), pick their desired politician class (and add or even describe themselves politicians beliefs), electoral system, historical time period or random, single player or multi, start as opposotion or try to stay in government.

## Game
If picked as opposition the game should start it in year 1 of the active government with current state of the country stated.
Initial phase of the game ends when the election happens and in case of the win the player should try to maintain his popularity to win the next election. After the first term ends and second election happens the user has the choice to continue or end the playthrough.

## UI
The main ui should show the territory in the center, polling below and popular current events.
