local scene = require("tests.scene")

tags("native-ui")
describe("recipe tooltip native", function()
    test("01 recipe-name", function()
        scene.capture("release-ui/01-recipe-name.png", 1600, 1000, 0.75)
    end)
end)
