using System.Text.Json;
using System.Text.Json.Serialization;

namespace Stillwater.Companion;

[JsonConverter(typeof(JsonStringEnumConverter<HangoutTextSize>))]
internal enum HangoutTextSize { Small, Medium, Large }

internal sealed record HangoutDisplayPreferences(int Width, int Height, HangoutTextSize TextSize)
{
    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Stillwater",
        "hangout-display.json");

    public static HangoutDisplayPreferences Default => new(340, 480, HangoutTextSize.Medium);

    public static HangoutDisplayPreferences Load()
    {
        if (!File.Exists(SettingsPath)) return Default;
        var settings = JsonSerializer.Deserialize<HangoutDisplayPreferences>(File.ReadAllText(SettingsPath))
            ?? throw new InvalidDataException("Hangout display preferences are empty.");
        if (settings.Width < 340 || settings.Height < 480 || !Enum.IsDefined(settings.TextSize))
            throw new InvalidDataException("Hangout display preferences are invalid.");
        return settings;
    }

    public void Save()
    {
        var directory = Path.GetDirectoryName(SettingsPath)!;
        Directory.CreateDirectory(directory);
        var temporaryPath = SettingsPath + ".tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(this));
        File.Move(temporaryPath, SettingsPath, true);
    }
}