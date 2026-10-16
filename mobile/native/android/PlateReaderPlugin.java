package __PACKAGE__;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * Reads the text in one camera picture (ML Kit, on the phone itself, no internet needed). The page shows the camera,
 * cuts the number plate area out of every few frames and sends it here as a JPEG; the page then looks for a number
 * plate in the lines that come back.
 */
@CapacitorPlugin(name = "PlateReader")
public class PlateReaderPlugin extends Plugin {

    // The page sends a small cropped JPEG (under 1000 pixels wide). Anything much bigger is refused or shrunk so a
    // huge picture can never run the phone out of memory.
    private static final int MAX_BASE64_CHARS = 4 * 1024 * 1024;
    private static final int MAX_DIMENSION = 2048;

    private TextRecognizer recognizer;

    @Override
    public void load() {
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String data = call.getString("image");
        if (data == null || data.isEmpty()) {
            call.reject("There is no picture to read.", "FAILED");
            return;
        }
        if (data.length() > MAX_BASE64_CHARS) {
            call.reject("The picture is too large.", "FAILED");
            return;
        }
        int comma = data.indexOf(',');
        if (data.startsWith("data:") && comma >= 0) data = data.substring(comma + 1);
        Bitmap bitmap;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            // Read only the size first, then decode at a reduced size (largest side at most MAX_DIMENSION).
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                call.reject("The picture could not be opened.", "FAILED");
                return;
            }
            int sample = 1;
            int longest = Math.max(bounds.outWidth, bounds.outHeight);
            while ((longest + sample - 1) / sample > MAX_DIMENSION) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (IllegalArgumentException e) {
            call.reject("The picture is not valid.", "FAILED");
            return;
        } catch (OutOfMemoryError e) {
            call.reject("The picture is too large.", "FAILED");
            return;
        }
        if (bitmap == null) {
            call.reject("The picture could not be opened.", "FAILED");
            return;
        }
        final Bitmap picture = bitmap;
        recognizer
            .process(InputImage.fromBitmap(picture, 0))
            .addOnSuccessListener(text -> {
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) lines.put(line.getText());
                }
                JSObject result = new JSObject();
                result.put("text", text.getText());
                result.put("lines", lines);
                picture.recycle();
                call.resolve(result);
            })
            .addOnFailureListener(e -> {
                picture.recycle();
                call.reject(e.getMessage() == null ? "The text could not be read." : e.getMessage(), "FAILED");
            });
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) recognizer.close();
        super.handleOnDestroy();
    }
}
