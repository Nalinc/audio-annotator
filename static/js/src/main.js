'use strict';

/*
 * Purpose:
 *   Combines all the components of the interface. Creates each component, gets task
 *   data, updates components. When the user submits their work this class gets the workers
 *   annotations and other data and submits to the backend
 * Dependencies:
 *   AnnotationStages (src/annotation_stages.js), PlayBar & WorkflowBtns (src/components.js), 
 *   HiddenImg (src/hidden_image.js), colormap (colormap/colormap.min.js) , Wavesurfer (lib/wavesurfer.min.js)
 * Globals variable from other files:
 *   colormap.min.js:
 *       magma // color scheme array that maps 0 - 255 to rgb values
 *    
 */
function Annotator() {
    this.wavesurfer;
    this.playBar;
    this.stages;
    this.workflowBtns;
    this.currentTask;
    this.taskStartTime;
    this.hiddenImage;
    // only automatically open instructions modal when first loaded
    this.instructionsViewed = false;
    // Boolean, true if currently sending http post request 
    this.sendingResponse = false;

    // Create color map for spectrogram
    var spectrogramColorMap = colormap({
        colormap: magma,
        nshades: 256,
        format: 'rgb',
        alpha: 1
    });

    // Create wavesurfer (audio visualization component)
    var height = 128;
    this.wavesurfer = Object.create(WaveSurfer);
    this.wavesurfer.init({
        container: '.audio_visual',
        waveColor: '#fff',
        progressColor: '#fff',
        // For the spectrogram the height is half the number of fftSamples
        fftSamples: height * 2,
        height: height,
        colorMap: spectrogramColorMap,
        hideScrollbar: true,
    });

    // Create labels (labels that appear above each region)
    var labels = Object.create(WaveSurfer.Labels);
    labels.init({
        wavesurfer: this.wavesurfer,
        container: '.labels'
    });

    // Create hiddenImage, an image that is slowly revealed to a user as they annotate 
    // (only for this.currentTask.feedback === 'hiddenImage')
    this.hiddenImage = new HiddenImg('.hidden_img', 100);
    this.hiddenImage.create();

    // Create the play button and time that appear below the wavesurfer
    this.playBar = new PlayBar(this.wavesurfer);
    this.playBar.create();

    // Create the annotation stages that appear below the wavesurfer. The stages contain tags 
    // the users use to label a region in the audio clip
    this.stages = new AnnotationStages(this.wavesurfer, this.hiddenImage);
    this.stages.create();

/*    // Create Workflow btns (submit and exit)
    this.workflowBtns = new WorkflowBtns();
    this.workflowBtns.create();

    this.addEvents();*/
}

Annotator.prototype = {
    addWaveSurferEvents: function() {
        var my = this;
        //Disable manual drag selection
        my.wavesurfer.regions.disableDragSelection();

        // function that moves the vertical progress bar to the current time in the audio clip
        var updateProgressBar = function () {
            var progress = my.wavesurfer.getCurrentTime() / my.wavesurfer.getDuration();
            my.wavesurfer.seekTo(progress);
        };

        // Update vertical progress bar to the currentTime when the sound clip is 
        // finished or paused since it is only updated on audioprocess
        this.wavesurfer.on('pause', updateProgressBar);
        this.wavesurfer.on('finish', function(){
            var markLastPortion = true;
            if(my.wavesurfer.getCurrentTime() == my.wavesurfer.backend.getDuration()){
                for (var index in my.wavesurfer.regions.list){
                    var region = my.wavesurfer.regions.list[index]
                    if(region.end == my.wavesurfer.backend.getDuration()){
                        markLastPortion = false;
                    }
                }
                if(markLastPortion)
                    my.clickToMarkRegion();
            }
            updateProgressBar();
        });

        // When a new sound file is loaded into the wavesurfer update the  play bar, update the 
        // annotation stages back to stage 1, update when the user started the task, update the workflow buttons.
        // Also if the user is suppose to get hidden image feedback, append that component to the page
        this.wavesurfer.on('ready', function () {
            my.playBar.update();
            my.stages.updateStage(1);
            my.updateTaskTime();
            my.workflowBtns.update();
            if (my.currentTask.feedback === 'hiddenImage') {
                my.hiddenImage.append(my.currentTask.imgUrl);
            }
        });

        this.wavesurfer.on('click', function (e) {
            my.stages.clickDeselectCurrentRegion();
        });
    },

    updateTaskTime: function() {
        this.taskStartTime = new Date().getTime();
    },

    clickToMarkRegion: function(){
        var index, options, startTime=0, endTime;
        var wavesurfer = this.wavesurfer;
        var currentTime = wavesurfer.getCurrentTime();

        /* Return if audio is not played yet*/
        if(!currentTime){
            return;
        }
        /*  
            Check if a region already exists?
            If yes, mark the begining of new region just after the end of last region.
            Else, start with 0.00
        */
        var prevRegion, nextRegion, regionToSplit, maxLastEndTime=Number.MIN_SAFE_INTEGER, minNextStartTime=Number.MAX_SAFE_INTEGER;
        for (index in wavesurfer.regions.list){
            var region = wavesurfer.regions.list[index];
            if(region.end==currentTime)
                return;
            if(region.end < currentTime && region.end > maxLastEndTime){
                maxLastEndTime=region.end;
                prevRegion=region;
            }
            if(region.start > currentTime && region.start < minNextStartTime){
                minNextStartTime=region.start;
                nextRegion=region;
            }
            if(currentTime > region.start && currentTime < region.end){
                regionToSplit = region;
            }
        }
        if(prevRegion)
            startTime = prevRegion.end + 0.01;
        else
            startTime = 0.01;
        if(nextRegion)
            endTime = nextRegion.start - 0.01;
        else
            endTime = currentTime;
        if(regionToSplit){
            regionToSplit.remove();
            var newSplitRegion = wavesurfer.addRegion({
                start: regionToSplit.start,
                end: currentTime - 0.01
            });
            wavesurfer.fireEvent('region-dblclick',newSplitRegion);
            startTime = currentTime + 0.01;
            if(!nextRegion)
                endTime = regionToSplit.end;
        }
        var newRegion = wavesurfer.addRegion({
            start: startTime,
            end: endTime
        });
        wavesurfer.fireEvent('region-dblclick',newRegion);
    },

    // Event Handler, if the user clicks submit annotations call submitAnnotations
    addWorkflowBtnEvents: function() {
        var that = this;
        $(this.workflowBtns).on('submit-annotations', this.submitAnnotations.bind(this));
        
        //Add a new region on clicking split button
        $(document).on("click", ".btn_split div",this.clickToMarkRegion.bind(this))
        
        //Add a New region on pressing key 's'
        $(document).bind("keydown", function(e){ 
            e = e || window.event;
            var charCode = e.which || e.keyCode;
            if(charCode==83)
                that.clickToMarkRegion()
        });
    },

    addEvents: function() {
        this.addWaveSurferEvents();
        this.addWorkflowBtnEvents();
    },

    // Update the task specific data of the interfaces components
    update: function() {
        var my = this;
        var mainUpdate = function(annotationSolutions) {

            // Update the different tags the user can use to annotate, also update the solutions to the
            // annotation task if the user is suppose to recieve feedback
            var proximityTags = my.currentTask.proximityTag;
            var annotationTags = my.currentTask.annotationTag;
            var tutorialVideoURL = my.currentTask.tutorialVideoURL;
            var alwaysShowTags = my.currentTask.alwaysShowTags;
            var instructions = my.currentTask.instructions;
            my.stages.reset(
                proximityTags,
                annotationTags,
                annotationSolutions,
                alwaysShowTags
            );

            // set video url
            $('#tutorial-video').attr('src', tutorialVideoURL);

            // add instructions
            var instructionsContainer = $('#instructions-container');
            instructionsContainer.empty();
            if (typeof instructions !== "undefined"){
                $('.modal-trigger').leanModal();
                instructions.forEach(function (instruction, index) {
                    if (index==0) {
                        // first instruction is the header
                        var instr = $('<h4>', {
                            html: instruction
                        });
                    } else {
                        var instr = $('<h6>', {
                            "class": "instruction",
                            html: instruction
                        });                    
                    }
                    instructionsContainer.append(instr);
                });
                if (!my.instructionsViewed) {
                    $('#instructions-modal').openModal();
                    my.instructionsViewed = true;
                }
            }
            else
            {
                $('#instructions-container').hide();
                $('#trigger').hide();
            }

            // Update the visualization type and the feedback type and load in the new audio clip
            my.wavesurfer.params.visualization = my.currentTask.visualization; // invisible, spectrogram, waveform
            my.wavesurfer.params.feedback = my.currentTask.feedback; // hiddenImage, silent, notify, none 
            my.wavesurfer.load(my.currentTask.url);

            // Create Workflow btns (submit and exit)
            my.workflowBtns = new WorkflowBtns();
            my.workflowBtns.create(my.currentTask.name);
            //my.workflowBtns.update();

            my.addEvents();
        };

        if (this.currentTask.feedback !== 'none') {
            // If the current task gives the user feedback, load the tasks solutions and then update
            // interface components
            $.getJSON(this.currentTask.annotationSolutionsUrl)
            .done(function(data) {
                mainUpdate(data);
            })
            .fail(function() {
                alert('Error: Unable to retrieve annotation solution set');
            });
        } else {
            // If not, there is no need to make an additional request. Just update task specific data right away
            mainUpdate({});
        }
    },

    // Update the interface with the next task's data
    loadNextTask: function() {
        var my = this;
        $.getJSON(dataUrl)
        .done(function(data) {
            my.currentTask = data.task;
            my.update();
        });
    },

    // Collect data about users annotations and submit it to the backend
    submitAnnotations: function() {
        // Check if all the regions have been labeled before submitting
        if (this.stages.annotationDataValidationCheck()) {
            if (this.sendingResponse) {
                // If it is already sending a post with the data, do nothing
                return;
            }
            this.sendingResponse = true;
            // Get data about the annotations the user has created
            var content = {
                task_start_time: this.taskStartTime,
                task_end_time: new Date().getTime(),
                visualization: this.wavesurfer.params.visualization,
                annotations: this.stages.getAnnotations(),
                deleted_annotations: this.stages.getDeletedAnnotations(),
                // List of the different types of actions they took to create the annotations
                annotation_events: this.stages.getEvents(),
                // List of actions the user took to play and pause the audio
                play_events: this.playBar.getEvents(),
                // Boolean, if at the end, the user was shown what city the clip was recorded in
                final_solution_shown: this.stages.aboveThreshold()
            };

            if (this.stages.aboveThreshold()) {
                // If the user is suppose to recieve feedback and got enough of the annotations correct
                // display the city the clip was recorded for 2 seconds and then submit their work
                var my = this;
                this.stages.displaySolution();
                setTimeout(function() {
                    my.post(content);
                }, 2000);
            } else {
                this.post(content);
            }
        }
    },

    // Make POST request, passing back the content data. On success load in the next task
    post: function (content) {
        var my = this;
        $.ajax({
            type: 'POST',
            url: $.getJSON(postUrl),
            contentType: 'application/json',
            data: JSON.stringify(content)
        })
        .done(function(data) {
            // If the last task had a hiddenImage component, remove it
            if (my.currentTask.feedback === 'hiddenImage') {
                my.hiddenImage.remove();
            }
            my.loadNextTask();
        })
        .fail(function() {
            alert('Error: Unable to Submit Annotations');
        })
        .always(function() {
            // No longer sending response
            my.sendingResponse = false;
        });
    }

};

function main() {
    // Create all the components
    var annotator = new Annotator();
    // Load the first audio annotation task
    annotator.loadNextTask();
}
main();
