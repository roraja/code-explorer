--
I should be able to answer questions like given the text which was present in clipboard, or given a text which is present in OS clipboard. Show me the complete data flow in clipboard based scenario.

--
Allow adding links to other symbols so user can jump to that symbol's analysis page easily. 
--
A function analysis page should show a numbered list of functioanlities it performs - like a validator function should like one by one what all things it validates. Have links to sub-functions if it is calling them but do give info on what that sub function does, its input and output.
--
If I am calculating analysis md for a symbol, then also ask the agent to find similar analysis for any other symbols it encounterss and cache those symbol md so if that symbol is requested, then llm calls can be saved.
--


--

Given a function, it should auto perform analysis on function it calls and the function which calls it upto 5 levels both up and down.
--
The enhance button doesn't enhance the details similar to how explore symbol does. Fix it.
--
Treat the codebase as a graph / tree of symbols. There should be placeholder files for all symbols in tree.
--
Allow saving investigations, easily view multiple investigations, load, edit investigations (simply a chain of symbols explored). Within an investigation, allow dragging to change order, removing symbol, adding notes.
--
Let cli be used by copilot. Have method "getContextForSymbol" which will get the symbol analysis as well as details of methods around it