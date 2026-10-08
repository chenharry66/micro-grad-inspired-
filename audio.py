# take in a file 

import av 
import io 
from av.audio.resampler import AudioResampler 


def decode(audio): 

    resampler = AudioResampler(format='fltp', layout='mono', rate= 16000)
    
    with av.open(audio) as container: 
        chunks = [] 
        for frame in container.decode(audio=0): 
            resampled_frames = resampler.resample(frame)
            for frame in resampled_frames: 
                # result is one row with numebr of smaples columns
                chunks.extend(frame.to_ndarray()[0].tolist())
            
        for frame in resampler.resample(None): 
            chunks.extend(frame.to_ndarray()[0].tolist())

    # chunks now contains all of my resampled n dimensional array make sure its of length 16000 
    res = chunks[:16000]

    res = res + (16000- len(res)) * [0]

    return res

def decode_file(file_path): 
    return decode(file_path)

def decode_bytes(audio_bytes): 
    return decode(io.BytesIO(audio_bytes))


