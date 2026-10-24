local scene = require("tests.scene")

tags("native-ui", "portal-gallery")
describe("Recipe tooltip gallery", function()
    test("01 recipe-name", function()
        scene.capture("gallery/01-recipe-name.png", 1920, 1080, 1.25)
    end)
end)
